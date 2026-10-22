// Persistence seam. Today: an in-memory array. Later: swap this module for a database-backed one
// that keeps the same three methods, and nothing else in the server has to change.
//
// Record shape:
// { playerId, nickname, netWpm, rawWpm, accuracy, position, durationSec, passageId, timestamp }

const MAX_RECORDS = 10000;

export function createRaceRepository() {
  const records = [];

  return {
    saveRace(entries) {
      for (const e of entries) {
        records.push(
          Object.freeze({
            playerId: e.playerId,
            nickname: e.nickname,
            netWpm: e.netWpm,
            rawWpm: e.rawWpm,
            accuracy: e.accuracy,
            position: e.position,
            durationSec: e.durationSec,
            passageId: e.passageId,
            timestamp: e.timestamp,
          }),
        );
      }
      if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
    },
    all() {
      return records.slice();
    },
    byPlayer(playerId) {
      return records.filter((r) => r.playerId === playerId);
    },
  };
}
