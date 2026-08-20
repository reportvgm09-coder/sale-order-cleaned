import { useEffect, useRef, useState } from "react";

/* A loader is dead time, so it hands you something to do with it. The game
   plays itself until a key is pressed and hands control back after a few
   seconds idle - nobody should have to play to see their orders. Nothing here
   touches the request it is waiting on. */

const W = 320;
const H = 224;
const PX = 2;                  // one sprite pixel, in canvas pixels
const COLS = 8;
const ROWS = 4;
const COL_W = 30;
const ROW_H = 20;
const GRID_TOP = 34;
const SHIP_Y = H - 40;      // leaves a strip under the floor for the spare ships
const SHIP_SPEED = 150;
const SHOT_SPEED = 280;
const BOMB_SPEED = 115;
const FIRE_COOL = 0.32;
const MAX_SHOTS = 2;
const IDLE_TO_AUTO = 6;        // seconds without input before it takes over again

const art = (rows) => {
  const pts = [];
  rows.forEach((row, y) => [...row].forEach((c, x) => c === "#" && pts.push([x, y])));
  return { pts, w: rows[0].length * PX, h: rows.length * PX };
};

const SQUID = [
  art([
    "...##...",
    "..####..",
    ".######.",
    "##.##.##",
    "########",
    "..#..#..",
    ".#.##.#.",
    "#.#..#.#",
  ]),
  art([
    "...##...",
    "..####..",
    ".######.",
    "##.##.##",
    "########",
    ".#.##.#.",
    "#.#..#.#",
    ".#....#.",
  ]),
];

const CRAB = [
  art([
    "..#.....#..",
    "...#...#...",
    "..#######..",
    ".##.###.##.",
    "###########",
    "#.#######.#",
    "#.#.....#.#",
    "...##.##...",
  ]),
  art([
    "..#.....#..",
    "#..#...#..#",
    "#.#######.#",
    "###.###.###",
    "###########",
    ".#########.",
    "..#.....#..",
    ".#.......#.",
  ]),
];

const OCTOPUS = [
  art([
    "....####....",
    ".##########.",
    "############",
    "###..##..###",
    "############",
    "..#.####.#..",
    "..#.#..#.#..",
    "....#..#....",
  ]),
  art([
    "....####....",
    ".##########.",
    "############",
    "###..##..###",
    "############",
    "...#.##.#...",
    "..#.#..#.#..",
    "..#......#..",
  ]),
];

const UFO = art([
  "....######....",
  "..##########..",
  ".############.",
  "##.##.##.##.##",
  "##############",
  "...###..###...",
  "....##..##....",
]);

const SHIP = art([
  ".....#.....",
  "....###....",
  "....###....",
  ".#########.",
  "###########",
  "###########",
  "###########",
]);

const KINDS = [SQUID, CRAB, CRAB, OCTOPUS];
const WORTH = [30, 20, 20, 10];

const drawArt = (ctx, a, cx, top) => {
  const x = Math.round(cx - a.w / 2);
  const y = Math.round(top);
  ctx.beginPath();
  a.pts.forEach(([px, py]) => ctx.rect(x + px * PX, y + py * PX, PX, PX));
  ctx.fill();
};

const overlap = (ax, ay, aw, ah, bx, by, bw, bh) =>
  ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

const wave = (n) => {
  const inv = [];
  const left = (W - COLS * COL_W) / 2 + COL_W / 2;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      inv.push({ x: left + c * COL_W, y: GRID_TOP + r * ROW_H, kind: r, col: c, alive: true });
    }
  }
  return { inv, dir: 1, step: 0, frame: 0, n };
};

const fresh = () => ({
  ...wave(1),
  ship: { x: W / 2, cool: 0, hit: 0, lives: 3 },
  shots: [],
  bombs: [],
  ufo: null,
  dodge: null,
  ufoIn: 7,
  bombIn: 1.2,
  score: 0,
  auto: true,
  idle: 0,
  keys: { left: false, right: false, fire: false },
});

export const Loader = ({ label = "Loading…" }) => {
  const canvas = useRef(null);
  const game = useRef(null);
  const [hud, setHud] = useState({ score: 0, wave: 1, auto: true });

  const press = (key, down) => {
    const g = game.current;
    if (!g) return;
    g.keys[key] = down;
    if (down) {
      g.auto = false;
      g.idle = 0;
    }
  };

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return undefined;

    const css = getComputedStyle(document.documentElement);
    const hsl = (name, alpha) => {
      const v = css.getPropertyValue(name).trim();
      return alpha == null ? `hsl(${v})` : `hsl(${v} / ${alpha})`;
    };
    const ink = {
      bg: hsl("--secondary"),
      band: hsl("--primary", 0.05),
      invader: hsl("--primary"),
      ship: hsl("--foreground"),
      shot: hsl("--primary"),
      bomb: hsl("--destructive"),
      ufo: hsl("--destructive"),
      ground: hsl("--border"),
    };

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);

    const g = fresh();
    game.current = g;

    const draw = () => {
      ctx.fillStyle = ink.bg;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = ink.band;
      for (let y = 0; y < H; y += 6) ctx.fillRect(0, y, W, 3);

      ctx.fillStyle = ink.ground;
      ctx.fillRect(0, SHIP_Y + SHIP.h + 4, W, 1);

      ctx.fillStyle = ink.invader;
      g.inv.forEach((v) => {
        if (v.alive) drawArt(ctx, KINDS[v.kind][g.frame], v.x, v.y);
      });

      if (g.ufo) {
        ctx.fillStyle = ink.ufo;
        drawArt(ctx, UFO, g.ufo.x, 12);
      }

      ctx.fillStyle = ink.shot;
      g.shots.forEach((s) => ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y), 2, 7));

      ctx.fillStyle = ink.bomb;
      g.bombs.forEach((b) => {
        const wobble = Math.floor(b.y / 4) % 2 ? 1 : -1;
        ctx.fillRect(Math.round(b.x) + wobble, Math.round(b.y), 2, 5);
      });

      // A hit ship blinks rather than vanishing, so you can see where it was.
      if (g.ship.hit <= 0 || Math.floor(g.ship.hit * 12) % 2) {
        ctx.fillStyle = ink.ship;
        drawArt(ctx, SHIP, g.ship.x, SHIP_Y);
      }

      ctx.fillStyle = ink.ship;
      ctx.globalAlpha = 0.35;
      for (let i = 0; i < g.ship.lives - 1; i += 1) drawArt(ctx, SHIP, 18 + i * 26, H - 18);
      ctx.globalAlpha = 1;
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw();
      return () => {
        game.current = null;
      };
    }

    const alive = () => g.inv.filter((v) => v.alive);

    const nextWave = (keepScore) => {
      Object.assign(g, wave(keepScore ? g.n + 1 : 1));
      g.shots = [];
      g.bombs = [];
      g.ufo = null;
      g.dodge = null;
      if (!keepScore) {
        g.score = 0;
        g.ship.lives = 3;
        g.ship.hit = 0;
      }
    };

    const lose = () => {
      g.ship.hit = 1.1;
      g.ship.lives -= 1;
      g.bombs = [];
      g.dodge = null;
      if (g.ship.lives <= 0) nextWave(false);
    };

    const fire = () => {
      if (g.ship.cool > 0 || g.shots.length >= MAX_SHOTS) return;
      g.shots.push({ x: g.ship.x, y: SHIP_Y - 6 });
      g.ship.cool = FIRE_COOL;
    };

    /* Autopilot works the bottom row upwards and aims where the target will
       be, not where it is - the block keeps marching while a shot is in the
       air, and firing at the current position mostly misses. It breaks off to
       dodge, because a ship that never dodges just flashes through its lives. */
    const autopilot = (dt, rest, pace) => {
      /* A dodge is held until that particular bomb is past. Re-deciding every
         frame looks like a dodge but is not one: the moment the ship is clear
         the threat reads as gone and it steers straight back into it. */
      if (g.dodge && (!g.bombs.includes(g.dodge.bomb) || g.dodge.bomb.y > SHIP_Y + SHIP.h)) {
        g.dodge = null;
      }
      if (!g.dodge) {
        const threat = g.bombs.find(
          (b) =>
            Math.abs(b.x - g.ship.x) < SHIP.w / 2 + 4 &&
            b.y < SHIP_Y &&
            (SHIP_Y - b.y) / BOMB_SPEED < 1,
        );
        // Break towards the roomier half, so the sidestep is never cut short
        // by the wall.
        if (threat) g.dodge = { bomb: threat, side: threat.x < W / 2 ? 1 : -1 };
      }

      // Lowest invader first, nearest one of those - a low target is a short
      // flight, and a short flight is a shot that still lands.
      const target = rest.reduce((best, v) => {
        if (!best || v.y > best.y) return v;
        if (v.y < best.y) return best;
        return Math.abs(v.x - g.ship.x) < Math.abs(best.x - g.ship.x) ? v : best;
      }, null);

      let want = g.ship.x;
      if (g.ufo) {
        want = g.ufo.x + g.ufo.dir * 55 * ((12 - SHIP_Y) / -SHOT_SPEED);
      } else if (target) {
        const flight = (SHIP_Y - target.y) / SHOT_SPEED;
        want = target.x + g.dir * 6 * (flight / pace);
      }
      // Sidestep to a spot measured from the bomb, not from the ship, or the
      // goalposts move every frame and it never actually gets clear.
      if (g.dodge) want = g.dodge.bomb.x + g.dodge.side * 28;

      const gap = want - g.ship.x;
      if (Math.abs(gap) > 2) g.ship.x += Math.sign(gap) * SHIP_SPEED * dt;

      // Fire at whatever it happens to be under, so a long dodge still scores.
      if (rest.some((v) => Math.abs(v.x - g.ship.x) < 4) || (!g.dodge && Math.abs(gap) < 4)) fire();
    };

    const update = (dt) => {
      if (!g.auto) {
        g.idle += dt;
        if (g.idle > IDLE_TO_AUTO && !g.keys.left && !g.keys.right && !g.keys.fire) g.auto = true;
      }

      g.ship.cool = Math.max(0, g.ship.cool - dt);
      g.ship.hit = Math.max(0, g.ship.hit - dt);

      let rest = alive();
      if (!rest.length) {
        nextWave(true);
        g.score += 100;
        rest = alive();
      }

      // Classic marching: the fewer left, the faster the block steps.
      const pace =
        (0.09 + 0.42 * (rest.length / (COLS * ROWS))) * Math.max(0.45, 1 - (g.n - 1) * 0.1);

      if (g.auto) {
        autopilot(dt, rest, pace);
      } else {
        if (g.keys.left) g.ship.x -= SHIP_SPEED * dt;
        if (g.keys.right) g.ship.x += SHIP_SPEED * dt;
        if (g.keys.fire) fire();
      }
      g.ship.x = Math.max(SHIP.w / 2 + 4, Math.min(W - SHIP.w / 2 - 4, g.ship.x));

      g.step += dt;
      if (g.step >= pace) {
        g.step -= pace;
        g.frame = g.frame ? 0 : 1;
        const edge = rest.reduce(
          (a, v) => {
            const half = KINDS[v.kind][0].w / 2;
            return [Math.min(a[0], v.x - half), Math.max(a[1], v.x + half)];
          },
          [W, 0],
        );
        if ((g.dir > 0 && edge[1] + 6 > W - 6) || (g.dir < 0 && edge[0] - 6 < 6)) {
          g.dir *= -1;
          g.inv.forEach((v) => {
            v.y += 8;
          });
        } else {
          g.inv.forEach((v) => {
            v.x += 6 * g.dir;
          });
        }
        if (rest.some((v) => v.y + KINDS[v.kind][0].h > SHIP_Y)) {
          lose();
          nextWave(false);
          return;
        }
      }

      g.ufoIn -= dt;
      if (!g.ufo && g.ufoIn <= 0) {
        const fromLeft = Math.random() < 0.5;
        g.ufo = { x: fromLeft ? -UFO.w : W + UFO.w, dir: fromLeft ? 1 : -1 };
      }
      if (g.ufo) {
        g.ufo.x += g.ufo.dir * 55 * dt;
        if (g.ufo.x < -UFO.w * 2 || g.ufo.x > W + UFO.w * 2) {
          g.ufo = null;
          g.ufoIn = 9 + Math.random() * 8;
        }
      }

      g.bombIn -= dt;
      if (g.bombIn <= 0) {
        g.bombIn = Math.max(0.35, 1.5 - g.n * 0.12) + Math.random() * 0.7;
        // Only the lowest invader in a column drops, so a bomb never appears
        // to pass through the row underneath it.
        const from = rest[Math.floor(Math.random() * rest.length)];
        const low = rest.filter((v) => v.col === from.col).sort((a, b) => b.y - a.y)[0];
        if (low) g.bombs.push({ x: low.x, y: low.y + KINDS[low.kind][0].h });
      }

      g.shots.forEach((s) => {
        s.y -= SHOT_SPEED * dt;
      });
      g.bombs.forEach((b) => {
        b.y += BOMB_SPEED * dt;
      });

      g.shots = g.shots.filter((s) => {
        if (s.y < -8) return false;
        if (g.ufo && overlap(s.x - 1, s.y, 2, 7, g.ufo.x - UFO.w / 2, 12, UFO.w, UFO.h)) {
          g.score += 150;
          g.ufo = null;
          g.ufoIn = 10 + Math.random() * 8;
          return false;
        }
        const hit = rest.find((v) => {
          const a = KINDS[v.kind][0];
          return v.alive && overlap(s.x - 1, s.y, 2, 7, v.x - a.w / 2, v.y, a.w, a.h);
        });
        if (hit) {
          hit.alive = false;
          g.score += WORTH[hit.kind];
          return false;
        }
        return true;
      });

      g.bombs = g.bombs.filter((b) => {
        if (b.y > SHIP_Y + SHIP.h) return false;
        if (g.ship.hit > 0) return true;
        if (overlap(b.x, b.y, 2, 5, g.ship.x - SHIP.w / 2, SHIP_Y, SHIP.w, SHIP.h)) {
          lose();
          return false;
        }
        return true;
      });
    };

    let raf = 0;
    let last = performance.now();
    let hudAt = 0;
    const loop = (now) => {
      /* A tab left in the background hands back a huge gap; capping it stops
         bullets teleporting straight through the invaders on return. The floor
         matters too - the first frame's timestamp can predate the clock read
         above, and a negative step drives everything backwards. */
      const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
      last = now;
      update(dt);
      draw();
      if (now - hudAt > 150) {
        hudAt = now;
        setHud((p) =>
          p.score === g.score && p.wave === g.n && p.auto === g.auto
            ? p
            : { score: g.score, wave: g.n, auto: g.auto },
        );
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const bind = (code, down) => {
      if (code === "ArrowLeft" || code === "KeyA") {
        press("left", down);
        return true;
      }
      if (code === "ArrowRight" || code === "KeyD") {
        press("right", down);
        return true;
      }
      if (code === "Space" || code === "ArrowUp" || code === "KeyW") {
        press("fire", down);
        return true;
      }
      return false;
    };
    const onDown = (e) => {
      if (e.repeat) return;
      if (bind(e.code, true)) e.preventDefault();
    };
    const onUp = (e) => {
      if (bind(e.code, false)) e.preventDefault();
    };
    const onBlur = () => {
      g.keys.left = false;
      g.keys.right = false;
      g.keys.fire = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      game.current = null;
    };
  }, []);

  const hold = (key) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      press(key, true);
    },
    onPointerUp: () => press(key, false),
    onPointerLeave: () => press(key, false),
    onPointerCancel: () => press(key, false),
  });

  const btn =
    "select-none rounded-sm border border-border bg-card px-4 py-1.5 font-mono text-xs font-semibold text-foreground active:bg-accent";

  return (
    <div className="flex min-h-[45vh] flex-col items-center justify-center gap-4" data-testid="app-loader">
      <div className="w-full max-w-[320px]">
        <div className="mb-1 flex items-end justify-between font-mono text-[11px] text-muted-foreground">
          <span data-testid="loader-score">SCORE {String(hud.score).padStart(4, "0")}</span>
          <span data-testid="loader-wave">WAVE {hud.wave}</span>
        </div>
        <canvas
          ref={canvas}
          className="w-full rounded-sm border border-border"
          style={{ imageRendering: "pixelated", aspectRatio: `${W} / ${H}` }}
          data-testid="loader-game"
        />
      </div>

      <div className="flex flex-col items-center gap-1">
        <div className="font-display text-sm font-bold uppercase tracking-[0.25em] text-foreground">{label}</div>
        <div className="font-mono text-[11px] text-muted-foreground" data-testid="loader-hint">
          {hud.auto ? "Press an arrow key to take over" : "← → move · space to fire"}
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" className={btn} aria-label="Move left" data-testid="loader-left" {...hold("left")}>
          ←
        </button>
        <button type="button" className={btn} aria-label="Fire" data-testid="loader-fire" {...hold("fire")}>
          FIRE
        </button>
        <button type="button" className={btn} aria-label="Move right" data-testid="loader-right" {...hold("right")}>
          →
        </button>
      </div>
    </div>
  );
};
