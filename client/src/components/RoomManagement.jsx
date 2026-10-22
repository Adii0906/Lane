import { useState } from 'react';
import InviteBox from './InviteBox.jsx';
import styles from './RoomManagement.module.css';

export default function RoomManagement({
  room,
  playerId,
  adminState,
  onKick,
  onApprove,
  onDecline,
  onUnblock,
}) {
  const [confirmPlayer, setConfirmPlayer] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const racers = room.players.filter((player) => player.id !== playerId && !player.kicked);
  const spectators = (room.spectators ?? []).filter((player) => player.id !== playerId);
  const activePlayers = [...racers, ...spectators];

  async function runAction(action, targetId) {
    setPendingId(targetId);
    try {
      await action(targetId);
    } finally {
      setPendingId(null);
    }
  }

  async function confirmKick() {
    if (!confirmPlayer) return;
    const target = confirmPlayer;
    setConfirmPlayer(null);
    await runAction(onKick, target.id);
  }

  return (
    <section className={styles.wrap}>
      <details className={styles.panel}>
        <summary className={styles.summary}>
          Manage players <span className={styles.count}>{activePlayers.length}</span>
        </summary>
        <div className={styles.content}>
          <div className={styles.invite}>
            <InviteBox code={room.code} />
          </div>

          <section className={styles.section} aria-labelledby="active-players-title">
            <h2 id="active-players-title" className={styles.sectionTitle}>Active Racers</h2>
            {activePlayers.length ? (
              <ul className={styles.list}>
                {activePlayers.map((player) => (
                  <li className={styles.player} key={player.id}>
                    <span className={styles.identity}>
                      <span className={styles.name}>{player.nickname}</span>
                      <span className={styles.meta}>
                        {player.role ?? (room.players.some((racer) => racer.id === player.id) ? 'Racer' : 'Spectator')}
                        {player.connected ? '' : ' - reconnecting'}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={styles.kick}
                      disabled={pendingId === player.id}
                      onClick={() => setConfirmPlayer(player)}
                      aria-label={`Remove ${player.nickname} from the room`}
                    >
                      Kick
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>No other players have joined yet.</p>
            )}
          </section>

          <section className={styles.section} aria-labelledby="rejoin-requests-title">
            <h2 id="rejoin-requests-title" className={styles.sectionTitle}>
              Rejoin Requests <span className={styles.count}>{adminState.rejoinRequests.length}</span>
            </h2>
            {adminState.rejoinRequests.length ? (
              <ul className={styles.list}>
                {adminState.rejoinRequests.map((request) => (
                  <li className={styles.player} key={request.id}>
                    <span className={styles.identity}>
                      <span className={styles.name}>{request.nickname}</span>
                      <span className={styles.meta}>Asking to rejoin</span>
                    </span>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.allow}
                        disabled={pendingId === request.id}
                        onClick={() => runAction(onApprove, request.id)}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className={styles.decline}
                        disabled={pendingId === request.id}
                        onClick={() => runAction(onDecline, request.id)}
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>No one is waiting for the green light.</p>
            )}
          </section>

          <section className={styles.section} aria-labelledby="blocked-players-title">
            <h2 id="blocked-players-title" className={styles.sectionTitle}>Blocked Players</h2>
            {adminState.blockedPlayers.length ? (
              <ul className={styles.list}>
                {adminState.blockedPlayers.map((player) => {
                  const hasRequest = adminState.rejoinRequests.some((request) => request.id === player.id);
                  return (
                    <li className={styles.player} key={player.id}>
                      <span className={styles.identity}>
                        <span className={styles.name}>{player.nickname}</span>
                        <span className={styles.meta}>
                          {hasRequest ? 'Rejoin request pending' : 'Kicked - awaiting host approval'}
                        </span>
                      </span>
                      <button
                        type="button"
                        className={styles.allow}
                        disabled={pendingId === player.id}
                        onClick={() => runAction(onUnblock, player.id)}
                      >
                        Allow Rejoin
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.empty}>No players are currently restricted.</p>
            )}
          </section>
        </div>
      </details>

      {confirmPlayer && (
        <div className={styles.modalBackdrop}>
          <section
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="kick-title"
            aria-describedby="kick-message"
          >
            <p className={styles.modalKicker}>🚗 Pit Stop Incoming!</p>
            <h2 id="kick-title" className={styles.modalTitle}>
              Send {confirmPlayer.nickname} to the pit lane?
            </h2>
            <p id="kick-message" className={styles.modalMessage}>
              Are you sure you want to send this racer to the pit lane? They might want a rematch!
            </p>
            <div className={styles.modalActions}>
              <button type="button" className={styles.allow} onClick={() => setConfirmPlayer(null)}>
                Let Them Race
              </button>
              <button type="button" className={styles.kick} onClick={confirmKick}>
                Send to Pit Stop
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
