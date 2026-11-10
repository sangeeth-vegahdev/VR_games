export const CFG = {
  // Pinch: thumb tip to index tip. Press at `pinchStart`, and the hand must open past `pinchRelease` before
  // it can press again, so one pinch is one press however much the fingers tremble.
  pinchStart: 0.03,
  pinchRelease: 0.055,

  launchSeconds: 0.8, // the ring closes and the room dims, then the game opens

  // The sport grid, in metres. At 1.7 m it spans about 41 x 24 degrees, which sits inside the narrow view of
  // Meta VR Glasses (37 degrees to each side, 25 up, 43 down), so every tile is reachable with the eyes alone.
  grid: {
    distance: 1.7,
    height: 1.6, // on a PC. In a headset the grid is placed at the player's own eye level, seated or standing.
    tileW: 0.62,
    tileH: 0.35,
    gap: 0.03,
    cornerR: 0.008,
    stickiness: 0.025, // the gaze must leave the focused tile by this much to move on, so the ring does not flicker
  },

  // Reading order. `key` on a PC is this position + 1. `span: 2` fills the row.
  games: [
    {
      id: 'baseball',
      title: 'Glove Up',
      art: 'baseball',
      row: 0,
      col: 0,
      port: 8082,
      storageKey: 'glove-up-best-25-major',
      bestSuffix: ' / 25',
    },
    {
      id: 'cricket',
      title: 'Cricket Catch',
      art: 'cricket',
      row: 0,
      col: 1,
      port: 8081,
      storageKey: 'cricket-catch-best-50',
      bestSuffix: ' / 50',
    },
    {
      id: 'bulbrush',
      title: 'Bulb Rush',
      art: 'bulb',
      row: 1,
      col: 0,
      span: 2,
      port: 8083,
      storageKey: 'bulbrush-best',
      bestSuffix: ' pts',
    },
  ],
};

// Where each game's tile sits on the grid: centre and size in metres, with (0, 0) at the middle of the grid.
export function tileRects(games = CFG.games, g = CFG.grid) {
  const rows = Math.max(...games.map((game) => game.row)) + 1;
  const pitchX = g.tileW + g.gap;
  const pitchY = g.tileH + g.gap;
  return games.map((game) => {
    const span = game.span || 1;
    return {
      x: (game.col + span / 2 - 1) * pitchX,
      y: ((rows - 1) / 2 - game.row) * pitchY,
      w: span * g.tileW + (span - 1) * g.gap,
      h: g.tileH,
    };
  });
}

export function gridSize(games = CFG.games, g = CFG.grid) {
  const rows = Math.max(...games.map((game) => game.row)) + 1;
  return { w: 2 * g.tileW + g.gap, h: rows * g.tileH + (rows - 1) * g.gap };
}

export function getGameUrl(game) {
  const loc = window.location;
  if (loc.port === '8080') {
    return `${loc.protocol}//${loc.hostname}:${game.port}`;
  }
  const basePath = loc.pathname.replace(/\/$/, '');
  const subfolder = game.id === 'bulbrush' ? 'bulb' : game.id;
  return `${loc.origin}${basePath}/${subfolder}/`;
}

// The saved best score, as shown on a tile, or null when this browser has none to show.
export function bestText(game, storage = globalThis.localStorage) {
  try {
    const stored = storage.getItem(game.storageKey);
    return stored === null || stored === undefined ? null : `Best ${stored}${game.bestSuffix}`;
  } catch (e) {
    return null; // storage blocked
  }
}
