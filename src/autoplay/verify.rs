//! Did the click actually land?
//!
//! A synthetic click can be swallowed — the UI was still animating, the
//! button had not finished popping in, the engine sampled the cursor a
//! frame too early. The press itself reports success either way: the page
//! dispatched the events, and nothing downstream says whether the client
//! did anything with them.
//!
//! The client's uplink identifies what a press requested. Steam additionally
//! requires the matching live server action: another discard, an accidental
//! timeout tsumogiri, or a different meld must not count as success. Passing
//! has no MJAI echo and is checked against the explicit cancel request.
//! The older counters remain available to browser autoplay.
//!
//! A counter rather than a timestamp: the question is "did *another* one
//! happen since my ticket", which a monotonic count answers without any
//! clock comparison, and which cannot be confused by two inputs landing in
//! the same millisecond.

use crate::schema::MjaiEvent;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::{
    collections::VecDeque,
    fs::{File, OpenOptions},
    io::Write,
    path::Path,
};

/// What an input command was, to the extent autoplay needs to tell them
/// apart.
///
/// Riichi is distinguished because only riichi has a failure that is
/// worse than nothing happening: the declaration and the discard are two
/// presses, and if the first is lost the second still discards — the tile
/// the bot picked as its riichi tile goes out with no riichi behind it.
/// On the wire the two are unmistakable (`inputOperation` `type: 7`
/// versus `type: 1`).
///
/// A plain discard is distinguished because it is the one input the
/// client also produces *on its own* in a way the client-initiated filter
/// cannot catch: an own-turn window that runs out is answered with a
/// tsumogiri stamped with a plausible `timeuse` and no `auto_operation`
/// flag — indistinguishable on the wire from a pressed tile. A plan that
/// clicked only action buttons can never legitimately produce a `type: 1`
/// discard, so counting one as proof the button landed would report
/// retries as "registered" at the exact moments the presses had
/// demonstrably failed (and reset the dead-click counter that decides
/// recovery reloads).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputKind {
    /// A riichi declaration (and its discard).
    Reach,
    /// A plain discard (`inputOperation` `type: 1`).
    Discard,
    /// Anything else the client accepted.
    Other,
}

/// Counts client commands and retains bounded command/server evidence.
#[derive(Debug, Default)]
pub struct InputWatch {
    sent: AtomicU64,
    reach: AtomicU64,
    non_discard: AtomicU64,
    last_sent: std::sync::Mutex<Option<std::time::Instant>>,
    evidence: std::sync::Mutex<Evidence>,
    audit: std::sync::Mutex<Option<File>>,
}

#[derive(Debug, Default)]
struct Evidence {
    inputs: VecDeque<(u64, Value)>,
    echoes: VecDeque<(u64, Vec<MjaiEvent>)>,
    echo_sequence: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionCheck {
    Pending,
    AwaitingServer,
    Confirmed,
    Mismatch,
}

/// A snapshot of the counts, taken before a click.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InputTicket {
    sent: u64,
    reach: u64,
    non_discard: u64,
    echo: u64,
}

impl InputWatch {
    /// The bridge saw the client send an input command.
    pub fn note_sent(&self, kind: InputKind) {
        *self.last_sent.lock().unwrap_or_else(|e| e.into_inner()) = Some(std::time::Instant::now());
        self.sent.fetch_add(1, Ordering::Relaxed);
        if kind == InputKind::Reach {
            self.reach.fetch_add(1, Ordering::Relaxed);
        }
        if kind != InputKind::Discard {
            self.non_discard.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Snapshot to compare against later.
    pub fn ticket(&self) -> InputTicket {
        let evidence = self.evidence.lock().unwrap_or_else(|e| e.into_inner());
        InputTicket {
            sent: self.sent.load(Ordering::Relaxed),
            reach: self.reach.load(Ordering::Relaxed),
            non_discard: self.non_discard.load(Ordering::Relaxed),
            echo: evidence.echo_sequence,
        }
    }

    /// Preserve the accepted command, not only its broad kind. The original
    /// counters remain available to the browser transport.
    pub fn note_command(&self, kind: InputKind, method: &str, payload: &Value) {
        let mut evidence = self.evidence.lock().unwrap_or_else(|e| e.into_inner());
        self.note_sent(kind);
        let sequence = self.sent.load(Ordering::Relaxed);
        let input = json!({"method": method, "type": payload.get("type"),
            "tile": payload.get("tile"), "moqie": payload.get("moqie"),
            "cancel_operation": payload.get("cancel_operation"),
            "index": payload.get("index"), "timeuse": payload.get("timeuse")});
        evidence.inputs.push_back((sequence, input.clone()));
        while evidence.inputs.len() > 32 {
            evidence.inputs.pop_front();
        }
        drop(evidence);
        self.record(json!({"event":"client_input", "sequence":sequence, "input":input}));
    }

    /// Called only for live server action notifications, never GameRestore.
    /// This proves what the server actually applied, including meld variants.
    pub fn note_server_actions(&self, events: &[MjaiEvent]) {
        let actions: Vec<_> = events
            .iter()
            .filter(|e| {
                matches!(
                    e,
                    MjaiEvent::Dahai { .. }
                        | MjaiEvent::Reach { .. }
                        | MjaiEvent::Chi { .. }
                        | MjaiEvent::Pon { .. }
                        | MjaiEvent::Daiminkan { .. }
                        | MjaiEvent::Ankan { .. }
                        | MjaiEvent::Kakan { .. }
                        | MjaiEvent::Hora { .. }
                        | MjaiEvent::Ryukyoku { .. }
                        | MjaiEvent::Kita { .. }
                )
            })
            .cloned()
            .collect();
        if actions.is_empty() {
            return;
        }
        let mut evidence = self.evidence.lock().unwrap_or_else(|e| e.into_inner());
        evidence.echo_sequence += 1;
        let sequence = evidence.echo_sequence;
        evidence.echoes.push_back((sequence, actions.clone()));
        while evidence.echoes.len() > 32 {
            evidence.echoes.pop_front();
        }
        drop(evidence);
        self.record(json!({"event":"server_actions", "sequence":sequence, "actions":actions}));
    }

    pub fn action_since(
        &self,
        ticket: InputTicket,
        expected: &MjaiEvent,
        riichi_discard: bool,
    ) -> ActionCheck {
        let evidence = self.evidence.lock().unwrap_or_else(|e| e.into_inner());
        let Some((_, input)) = evidence.inputs.iter().find(|(seq, _)| *seq > ticket.sent) else {
            return if self.sent_since(ticket) {
                ActionCheck::Mismatch
            } else {
                ActionCheck::Pending
            };
        };
        let declining_riichi_prompt = riichi_discard
            && matches!(
                expected,
                MjaiEvent::Dahai {
                    tsumogiri: true,
                    ..
                }
            )
            && command_matches(input, &MjaiEvent::None);
        if !command_matches(input, expected) && !declining_riichi_prompt {
            return ActionCheck::Mismatch;
        }
        // Passing has no MJAI action echo. Its explicit cancel request is the
        // available evidence; a discard or a different button cannot replace it.
        if matches!(expected, MjaiEvent::None) {
            return ActionCheck::Confirmed;
        }
        let wanted_actor = action_actor(expected);
        for (_, events) in evidence.echoes.iter().filter(|(seq, _)| *seq > ticket.echo) {
            if let MjaiEvent::Reach {
                actor,
                pai: Some(pai),
            } = expected
            {
                if let Some(MjaiEvent::Dahai { pai: actual, .. }) = events
                    .iter()
                    .find(|e| matches!(e, MjaiEvent::Dahai { actor: a, .. } if a == actor))
                {
                    return if actual == pai
                        && events
                            .iter()
                            .any(|e| matches!(e, MjaiEvent::Reach {actor: a, ..} if a == actor))
                    {
                        ActionCheck::Confirmed
                    } else {
                        ActionCheck::Mismatch
                    };
                }
            } else if let Some(actual) = events.iter().find(|e| action_actor(e) == wanted_actor) {
                return if action_matches(actual, expected) {
                    ActionCheck::Confirmed
                } else {
                    ActionCheck::Mismatch
                };
            }
        }
        ActionCheck::AwaitingServer
    }

    pub fn open_audit(&self, path: &Path) -> std::io::Result<()> {
        *self.audit.lock().unwrap_or_else(|e| e.into_inner()) =
            Some(OpenOptions::new().create(true).append(true).open(path)?);
        self.record(json!({"event":"session_start", "pid":std::process::id()}));
        Ok(())
    }

    /// Separate, synchronous evidence file: a UI log filter cannot suppress it.
    pub fn record(&self, mut entry: Value) {
        entry["ts"] = chrono::Local::now()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            .into();
        if let Some(file) = self
            .audit
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
        {
            if serde_json::to_writer(&mut *file, &entry).is_ok() {
                let _ = file.write_all(b"\n");
            }
        }
    }

    /// Whether any input command has been sent since `ticket` was taken.
    pub fn sent_since(&self, ticket: InputTicket) -> bool {
        self.sent.load(Ordering::Relaxed) != ticket.sent
    }

    /// A manual input retires a server operation window immediately, before
    /// its echo advances the tracker revision.
    pub fn sent_after(&self, opened_at: std::time::Instant) -> bool {
        self.last_sent
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some_and(|at| at >= opened_at)
    }

    /// Whether an input command *other than a plain discard* has been sent
    /// since `ticket` was taken — the proof standard for a plan whose
    /// clicks were all action buttons, where a discard can only mean the
    /// client's own turn-timeout tsumogiri.
    pub fn non_discard_since(&self, ticket: InputTicket) -> bool {
        self.non_discard.load(Ordering::Relaxed) != ticket.non_discard
    }

    /// Whether a *riichi* input has been sent since `ticket` was taken.
    pub fn reach_since(&self, ticket: InputTicket) -> bool {
        self.reach.load(Ordering::Relaxed) != ticket.reach
    }
}

fn command_matches(input: &Value, expected: &MjaiEvent) -> bool {
    let operation = input["type"].as_u64();
    let cancel = input["cancel_operation"].as_bool().unwrap_or(false);
    if matches!(expected, MjaiEvent::None) {
        return cancel && operation == Some(0);
    }
    if cancel {
        return false;
    }
    let kind = match expected {
        MjaiEvent::Dahai { .. } => 1,
        MjaiEvent::Chi { .. } => 2,
        MjaiEvent::Pon { .. } => 3,
        MjaiEvent::Ankan { .. } => 4,
        MjaiEvent::Daiminkan { .. } => 5,
        MjaiEvent::Kakan { .. } => 6,
        MjaiEvent::Reach { pai: Some(_), .. } => 7,
        MjaiEvent::Hora { actor, target, .. } => {
            if actor == target {
                8
            } else {
                9
            }
        }
        MjaiEvent::Ryukyoku { .. } => 10,
        MjaiEvent::Kita { .. } => 11,
        _ => return false,
    };
    if operation != Some(kind) {
        return false;
    }
    match expected {
        MjaiEvent::Dahai { pai, tsumogiri, .. } => {
            input["tile"]
                .as_str()
                .and_then(|s| crate::bridge::majsoul::tile::ms_to_mjai(s).ok())
                == Some(pai.as_str())
                && input["moqie"].as_bool().unwrap_or(false) == *tsumogiri
        }
        MjaiEvent::Reach { pai: Some(pai), .. } => {
            input["tile"]
                .as_str()
                .and_then(|s| crate::bridge::majsoul::tile::ms_to_mjai(s).ok())
                == Some(pai.as_str())
        }
        _ => true,
    }
}

fn action_actor(action: &MjaiEvent) -> Option<u8> {
    match action {
        MjaiEvent::Dahai { actor, .. }
        | MjaiEvent::Reach { actor, .. }
        | MjaiEvent::Chi { actor, .. }
        | MjaiEvent::Pon { actor, .. }
        | MjaiEvent::Daiminkan { actor, .. }
        | MjaiEvent::Ankan { actor, .. }
        | MjaiEvent::Kakan { actor, .. }
        | MjaiEvent::Hora { actor, .. }
        | MjaiEvent::Kita { actor, .. } => Some(*actor),
        _ => None,
    }
}

fn action_matches(actual: &MjaiEvent, expected: &MjaiEvent) -> bool {
    let normalize = |event: &MjaiEvent| {
        let mut value = serde_json::to_value(event).unwrap_or(Value::Null);
        if let Some(consumed) = value.get_mut("consumed").and_then(Value::as_array_mut) {
            consumed.sort_by(|a, b| a.as_str().cmp(&b.as_str()));
        }
        if let Some(object) = value.as_object_mut() {
            object.remove("deltas");
            object.remove("ura_markers");
            if matches!(event, MjaiEvent::Kita { .. }) {
                object.remove("pai");
            }
        }
        value
    };
    normalize(actual) == normalize(expected)
}

/// Shared between the bridge (which counts) and the autoplay manager
/// (which checks). `Relaxed` ordering throughout: the only thing that
/// matters is that the count eventually differs, and every observation is
/// separated from the write by a real timer wait.
pub type SharedInputWatch = Arc<InputWatch>;

#[cfg(test)]
mod tests {
    use super::*;

    fn event(value: Value) -> MjaiEvent {
        serde_json::from_value(value).unwrap()
    }
    fn command(watch: &InputWatch, kind: InputKind, value: Value) {
        watch.note_command(kind, ".lq.FastTest.inputOperation", &value);
    }

    #[test]
    fn a_wrong_or_timeout_discard_is_not_the_requested_tile() {
        let watch = InputWatch::default();
        let ticket = watch.ticket();
        let expected = event(json!({"type":"dahai","actor":2,"pai":"2m","tsumogiri":false}));
        command(
            &watch,
            InputKind::Discard,
            json!({"type":1,"tile":"4s","moqie":true,"timeuse":24}),
        );
        watch.note_server_actions(&[event(
            json!({"type":"dahai","actor":2,"pai":"4s","tsumogiri":true}),
        )]);
        assert_eq!(
            watch.action_since(ticket, &expected, false),
            ActionCheck::Mismatch
        );
    }

    #[test]
    fn matching_discard_needs_the_server_echo_for_the_same_seat() {
        let watch = InputWatch::default();
        let expected = event(json!({"type":"dahai","actor":2,"pai":"W","tsumogiri":false}));
        let ticket = watch.ticket();
        assert_eq!(
            watch.action_since(ticket, &expected, false),
            ActionCheck::Pending
        );
        command(
            &watch,
            InputKind::Discard,
            json!({"type":1,"tile":"3z","moqie":false}),
        );
        assert_eq!(
            watch.action_since(ticket, &expected, false),
            ActionCheck::AwaitingServer
        );
        watch.note_server_actions(&[event(
            json!({"type":"dahai","actor":1,"pai":"W","tsumogiri":false}),
        )]);
        assert_eq!(
            watch.action_since(ticket, &expected, false),
            ActionCheck::AwaitingServer
        );
        watch.note_server_actions(&[expected.clone()]);
        assert_eq!(
            watch.action_since(ticket, &expected, false),
            ActionCheck::Confirmed
        );
        let next = watch.ticket();
        assert_eq!(
            watch.action_since(next, &expected, false),
            ActionCheck::Pending
        );
    }

    #[test]
    fn ordinary_five_cannot_confirm_red_five() {
        let expected = event(json!({"type":"dahai","actor":0,"pai":"5pr","tsumogiri":false}));
        for (tile, want) in [
            ("5p", ActionCheck::Mismatch),
            ("0p", ActionCheck::Confirmed),
        ] {
            let watch = InputWatch::default();
            let ticket = watch.ticket();
            command(
                &watch,
                InputKind::Discard,
                json!({"type":1,"tile":tile,"moqie":false}),
            );
            watch.note_server_actions(&[expected.clone()]);
            assert_eq!(watch.action_since(ticket, &expected, false), want);
        }
    }

    #[test]
    fn reach_needs_both_the_declaration_and_its_exact_tile() {
        let expected = event(json!({"type":"reach","actor":0,"pai":"6s"}));
        for (operation, declare, tile, want) in [
            (1, false, "6s", ActionCheck::Mismatch),
            (7, false, "6s", ActionCheck::Mismatch),
            (7, true, "7s", ActionCheck::Mismatch),
            (7, true, "6s", ActionCheck::Confirmed),
        ] {
            let watch = InputWatch::default();
            let ticket = watch.ticket();
            command(
                &watch,
                InputKind::Reach,
                json!({"type":operation,"tile":"6s"}),
            );
            let mut events = Vec::new();
            if declare {
                events.push(event(json!({"type":"reach","actor":0})));
            }
            events.push(event(
                json!({"type":"dahai","actor":0,"pai":tile,"tsumogiri":false}),
            ));
            watch.note_server_actions(&events);
            assert_eq!(watch.action_since(ticket, &expected, false), want);
        }
    }

    #[test]
    fn meld_verification_checks_the_consumed_tiles_not_just_the_button() {
        let expected =
            event(json!({"type":"pon","actor":0,"target":3,"pai":"5p","consumed":["5p","5pr"]}));
        for (consumed, want) in [
            (json!(["5p", "5p"]), ActionCheck::Mismatch),
            (json!(["5pr", "5p"]), ActionCheck::Confirmed),
        ] {
            let watch = InputWatch::default();
            let ticket = watch.ticket();
            watch.note_command(
                InputKind::Other,
                ".lq.FastTest.inputChiPengGang",
                &json!({"type":3,"index":0}),
            );
            watch.note_server_actions(&[event(
                json!({"type":"pon","actor":0,"target":3,"pai":"5p","consumed":consumed}),
            )]);
            assert_eq!(watch.action_since(ticket, &expected, false), want);
        }
    }

    #[test]
    fn a_different_action_button_cannot_confirm_pass() {
        for (payload, want) in [
            (
                json!({"type":3,"cancel_operation":false}),
                ActionCheck::Mismatch,
            ),
            (
                json!({"type":0,"cancel_operation":true}),
                ActionCheck::Confirmed,
            ),
        ] {
            let watch = InputWatch::default();
            let ticket = watch.ticket();
            watch.note_command(InputKind::Other, ".lq.FastTest.inputChiPengGang", &payload);
            assert_eq!(watch.action_since(ticket, &MjaiEvent::None, false), want);
        }
    }

    #[test]
    fn evidence_is_written_without_a_tracing_subscriber() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("autoplay.jsonl");
        let watch = InputWatch::default();
        watch.open_audit(&path).unwrap();
        command(
            &watch,
            InputKind::Discard,
            json!({"type":1,"tile":"3z","moqie":false}),
        );
        watch.note_server_actions(&[event(
            json!({"type":"dahai","actor":2,"pai":"W","tsumogiri":false}),
        )]);
        let rows: Vec<Value> = std::fs::read_to_string(&path)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1]["input"]["tile"], "3z");
        assert_eq!(rows[2]["actions"][0]["pai"], "W");
    }

    #[test]
    fn riichi_prompt_cancel_requires_the_expected_automatic_discard() {
        let watch = InputWatch::default();
        let ticket = watch.ticket();
        let expected = event(json!({"type":"dahai","actor":0,"pai":"N","tsumogiri":true}));
        command(
            &watch,
            InputKind::Other,
            json!({"type":0,"cancel_operation":true}),
        );
        assert_eq!(
            watch.action_since(ticket, &expected, false),
            ActionCheck::Mismatch
        );
        assert_eq!(
            watch.action_since(ticket, &expected, true),
            ActionCheck::AwaitingServer
        );
        watch.note_server_actions(&[expected.clone()]);
        assert_eq!(
            watch.action_since(ticket, &expected, true),
            ActionCheck::Confirmed
        );
    }

    #[test]
    fn manual_input_retires_the_window_before_the_server_echo() {
        let watch = InputWatch::default();
        let previous_window = std::time::Instant::now();
        assert!(!watch.sent_after(previous_window));
        watch.note_sent(InputKind::Discard);
        assert!(watch.sent_after(previous_window));
        let next_window = std::time::Instant::now();
        assert!(!watch.sent_after(next_window));
    }

    #[test]
    fn a_ticket_only_moves_when_input_is_sent() {
        let w = InputWatch::default();
        let t = w.ticket();
        assert!(!w.sent_since(t), "nothing sent yet");
        w.note_sent(InputKind::Other);
        assert!(w.sent_since(t));
    }

    /// The case this exists for: a riichi plan whose declaration press was
    /// lost still produces an input command — the discard — so presence
    /// alone reads as success while the hand has in fact discarded the
    /// riichi tile without declaring.
    #[test]
    fn a_plain_discard_does_not_pass_for_a_riichi() {
        let w = InputWatch::default();
        let t = w.ticket();
        w.note_sent(InputKind::Other);
        assert!(w.sent_since(t), "something was sent");
        assert!(!w.reach_since(t), "but it was not the riichi");

        let t = w.ticket();
        w.note_sent(InputKind::Reach);
        assert!(w.reach_since(t));
    }

    /// Each press takes its own ticket: input from the *previous* decision
    /// must not make the next click look like it registered.
    #[test]
    fn each_ticket_is_independent() {
        let w = InputWatch::default();
        w.note_sent(InputKind::Other);
        let t = w.ticket();
        assert!(!w.sent_since(t), "a fresh ticket starts clean");
        w.note_sent(InputKind::Other);
        assert!(w.sent_since(t));
    }

    /// An own-turn window that expires is answered by the client with a
    /// tsumogiri that looks exactly like a pressed tile on the wire (small
    /// `timeuse`, no `auto_operation`). It must not stand in as proof that
    /// an action-button press landed — a plan that clicked only buttons
    /// cannot legitimately produce a plain discard.
    #[test]
    fn a_plain_discard_does_not_prove_a_button_press() {
        let w = InputWatch::default();
        let t = w.ticket();
        w.note_sent(InputKind::Discard);
        assert!(w.sent_since(t), "a discard is still an input");
        assert!(
            !w.non_discard_since(t),
            "but it proves nothing about a button"
        );

        // Anything that is not a plain discard does prove it.
        let t = w.ticket();
        w.note_sent(InputKind::Other);
        assert!(w.non_discard_since(t));
        let t = w.ticket();
        w.note_sent(InputKind::Reach);
        assert!(w.non_discard_since(t), "a riichi declaration counts");
    }

    /// Two inputs inside the same millisecond are two inputs — the reason
    /// this is a count and not a timestamp.
    #[test]
    fn back_to_back_inputs_both_count() {
        let w = InputWatch::default();
        let t0 = w.ticket();
        w.note_sent(InputKind::Other);
        let t1 = w.ticket();
        w.note_sent(InputKind::Other);
        assert!(w.sent_since(t0) && w.sent_since(t1));
    }
}
