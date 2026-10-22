// Every Socket.IO event name lives here. Never type an event string anywhere else.

export const EVENTS = Object.freeze({
  // client -> server (intents)
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  SET_DURATION: 'set_duration',
  SET_READY: 'set_ready',
  PROGRESS: 'progress',
  REMATCH: 'rematch',
  KICK_PLAYER: 'kick_player',
  APPROVE_REJOIN: 'approve_rejoin',
  DECLINE_REJOIN: 'decline_rejoin',
  UNBLOCK_PLAYER: 'unblock_player',
  REQUEST_REJOIN: 'request_rejoin',
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
  ROOM_KICKED: 'room_kicked',
  ROOM_ADMIN: 'room_admin',
  ROOM_ADMIN_STATE: 'room_admin_state',
  REJOIN_APPROVED: 'rejoin_approved',
  REJOIN_DECLINED: 'rejoin_declined',
});
