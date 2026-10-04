use super::*;
use crate::autoplay::{verify::ActionCheck, AutoplayContext};
use crate::bridge::majsoul::parser::{POOL, ROUTES};
use prost::Message as _;
use prost_reflect::DynamicMessage;
use serde_json::{json, Value};

fn encode(kind: &str, value: Value) -> Vec<u8> {
    let json = value.to_string();
    DynamicMessage::deserialize(
        POOL.get_message_by_name(kind.trim_start_matches('.'))
            .unwrap(),
        &mut serde_json::Deserializer::from_str(&json),
    )
    .unwrap()
    .encode_to_vec()
}

fn wire(kind: u8, id: u16, method: &str, bytes: Vec<u8>) -> Vec<u8> {
    let mut frame = vec![kind];
    if kind != 1 {
        frame.extend_from_slice(&id.to_le_bytes());
    }
    frame.extend(encode(
        "lq.Wrapper",
        json!({"name":method,"data":b64(&bytes)}),
    ));
    frame
}

fn rpc(kind: u8, id: u16, method: &str, payload: Value) -> Vec<u8> {
    let role = if kind == 2 { "req" } else { "resp" };
    wire(
        kind,
        id,
        if kind == 3 { "" } else { method },
        encode(ROUTES[method][role].as_str().unwrap(), payload),
    )
}

fn draw(seat: u32, operation: Value) -> Vec<u8> {
    action(
        "ActionDealTile",
        json!({"seat":seat,"tile":"1m","operation":operation}),
    )
}

fn action(name: &str, payload: Value) -> Vec<u8> {
    let mut action = encode(&format!("lq.{name}"), payload);
    let keys = [0x84, 0x5e, 0x4e, 0x42, 0x39, 0xa2, 0x1f, 0x60, 0x1c];
    let base = 23 ^ action.len();
    for (i, byte) in action.iter_mut().enumerate() {
        *byte ^= (base + 5 * i + keys[i % 9]) as u8;
    }
    wire(
        1,
        0,
        ".lq.ActionPrototype",
        encode(
            "lq.ActionPrototype",
            json!({"name":name,"data":b64(&action)}),
        ),
    )
}

#[test]
fn mitm_bridge_publishes_budget_and_input_to_steam_context() {
    let temp = tempfile::tempdir().unwrap();
    let session = Arc::new(Session::init(temp.path(), "warn", "warn", &[]).unwrap());
    let autoplay = Arc::new(AutoplayContext::new());
    let handler = ProxyHandler::new(
        session,
        Platform::Majsoul,
        None,
        None,
        Arc::new(Notify::new()),
        HttpCapturePolicy::default(),
        Arc::new(CertStore::default()),
        false,
        false,
        None,
    )
    .unwrap()
    .with_autoplay(Some(autoplay.clone()));
    let flow = handler.acquire_bridge(
        "127.0.0.1:32001".parse().unwrap(),
        &"https://example.test/game-gateway".parse().unwrap(),
    );
    let mut bridge = flow.lock().unwrap();
    bridge.parse(
        Direction::Up,
        &rpc(
            2,
            1,
            ".lq.FastTest.authGame",
            json!({"account_id":1001,"game_uuid":"autoplay-wiring-test"}),
        ),
    );
    bridge.parse(
        Direction::Down,
        &rpc(
            3,
            1,
            ".lq.FastTest.authGame",
            json!({"seat_list":[1001,1002,1003,1004]}),
        ),
    );
    let own_draw = draw(
        0,
        json!({"seat":0,"time_fixed":5000,"time_add":20000,"operation_list":[{"type":1}]}),
    );
    bridge.parse(Direction::Down, &own_draw);
    let window = autoplay
        .time_budget
        .read()
        .unwrap()
        .expect("Steam needs the MITM operation window");
    assert_eq!((window.fixed_ms, window.add_ms), (5000, 20000));

    // A lobby/probe flow without a seat must not erase the playing flow's clock.
    let lobby = handler.acquire_bridge(
        "127.0.0.1:32002".parse().unwrap(),
        &"https://example.test/gateway".parse().unwrap(),
    );
    lobby
        .lock()
        .unwrap()
        .parse(Direction::Down, &draw(1, Value::Null));
    assert_eq!(
        autoplay.time_budget.read().unwrap().unwrap().observed_at,
        window.observed_at
    );
    {
        let mut probe = lobby.lock().unwrap();
        probe.parse(
            Direction::Up,
            &rpc(
                2,
                10,
                ".lq.FastTest.authGame",
                json!({"account_id":9999,"game_uuid":"probe"}),
            ),
        );
        probe.parse(
            Direction::Down,
            &rpc(3, 10, ".lq.FastTest.authGame", json!({"error":{"code":1}})),
        );
    }
    assert_eq!(
        autoplay
            .time_budget
            .read()
            .unwrap()
            .expect("failed auth on another flow must not clear our clock")
            .observed_at,
        window.observed_at
    );
    lobby.lock().unwrap().parse(
        Direction::Down,
        &wire(
            1,
            0,
            ".lq.NotifyGameTerminate",
            encode("lq.NotifyGameTerminate", json!({})),
        ),
    );
    assert_eq!(
        autoplay
            .time_budget
            .read()
            .unwrap()
            .expect("an unseated terminated flow must not clear our clock")
            .observed_at,
        window.observed_at
    );

    let ticket = autoplay.input_watch.ticket();
    assert!(!autoplay.input_watch.sent_since(ticket));
    bridge.parse(
        Direction::Up,
        &rpc(
            2,
            2,
            ".lq.FastTest.inputOperation",
            json!({"type":1,"tile":"1m","timeuse":1}),
        ),
    );
    assert!(
        autoplay.input_watch.sent_since(ticket),
        "Steam must see the same uplink acknowledgement as the parser"
    );
    assert!(autoplay.input_watch.sent_after(window.observed_at));
    let expected = crate::schema::MjaiEvent::Dahai {
        actor: 0,
        pai: "1m".into(),
        tsumogiri: false,
    };
    assert_eq!(
        autoplay.input_watch.action_since(ticket, &expected, false),
        ActionCheck::AwaitingServer,
        "an uplink alone must not confirm execution"
    );
    let other_tile = crate::schema::MjaiEvent::Dahai {
        actor: 0,
        pai: "9p".into(),
        tsumogiri: false,
    };
    assert_eq!(
        autoplay
            .input_watch
            .action_since(ticket, &other_tile, false),
        ActionCheck::Mismatch,
        "typed wire input must retain the actual tile"
    );
    bridge.parse(
        Direction::Down,
        &action(
            "ActionDiscardTile",
            json!({"seat":0,"tile":"1m","moqie":false}),
        ),
    );
    assert_eq!(
        autoplay.input_watch.action_since(ticket, &expected, false),
        ActionCheck::Confirmed,
        "a matching live server action must reach the Steam verifier"
    );
    bridge.parse(Direction::Down, &draw(1, Value::Null));
    assert!(
        autoplay.time_budget.read().unwrap().is_none(),
        "closed decisions must revoke the clock"
    );
}
