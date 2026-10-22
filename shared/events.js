// Every Socket.IO event name lives here. Never type an event string anywhere else.

export const EVENTS = Object.freeze({
  // client -> server (intents)
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  SET_DURATION: 'set_duration',
  SET_READY: 'set_ready',
  PROGRESS: 'progress',
  REMATCH: 'rematch',
  LEAVE: 'leave',
  TIME_SYNC: 'time_sync',

  // server -> client (state)
  ROOM_STATE: 'room_state',
  COUNTDOWN: 'countdown',
  COUNTDOWN_CANCEL: 'countdown_cancel',
  RACE_START: 'race_start',
  RACE_UPDATE: 'race_update',
  PLAYER_FINISHED: 'player_finished',
  RACE_END: 'race_end',
  ERROR: 'error',
});
