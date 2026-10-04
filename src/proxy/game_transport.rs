//! Liveness of the Mahjong Soul gameplay socket, separate from the MITM listener.
use std::{
    net::SocketAddr,
    sync::{Mutex, OnceLock},
};

#[derive(Default)]
struct Connection {
    current: Option<SocketAddr>,
}
impl Connection {
    fn observe_game(&mut self, client: SocketAddr) {
        self.current = Some(client);
    }
    fn close(&mut self, client: SocketAddr) {
        if self.current == Some(client) {
            self.current = None;
        }
    }
}
fn shared() -> &'static Mutex<Connection> {
    static STATE: OnceLock<Mutex<Connection>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(Connection::default()))
}
pub fn observe_game(client: SocketAddr) {
    if let Ok(mut s) = shared().lock() {
        s.observe_game(client);
    }
}
pub fn close(client: SocketAddr) {
    if let Ok(mut s) = shared().lock() {
        s.close(client);
    }
}
pub fn connected() -> bool {
    shared().lock().is_ok_and(|s| s.current.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_lobby_socket_does_not_establish_game_liveness_and_old_closes_cannot_kill_reconnect() {
        let a = "127.0.0.1:1".parse().unwrap();
        let b = "127.0.0.1:2".parse().unwrap();
        let mut s = Connection::default();
        s.close(a);
        assert!(s.current.is_none());
        s.observe_game(a);
        s.observe_game(b);
        s.close(a);
        assert_eq!(s.current, Some(b));
        s.close(b);
        assert!(s.current.is_none());
    }
}
