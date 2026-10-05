# house.wad

**Your house, as a Doom level. Shooting the lamp turns off the light.**

house.wad is a Home Assistant dashboard card. It reads your floors, areas and devices, builds a Doom level out of them, and runs the real Doom engine in the card. What you do in the game happens in the house, and what happens in the house shows up in the game.

| In the game | In your house |
|---|---|
| Shoot a lamp | The light turns off |
| Walk up to a lamp and press Use | The light turns on |
| Press Use on a wall switch | The switch toggles |
| Shoot a wall switch | It turns off |
| Use / shoot the screen on the wall | Play/pause / mute the media player |
| Use the door with the red frame | Your front door unlocks (after a Y/N prompt) |
| Use the big door in the garage | The garage door opens (after a Y/N prompt) |
| Room light level | Follows that room's real lights |
| Doors | Open when the real door is open or unlocked |

### The house's problems are demons

| Monster | What it is | Killing it |
|---|---|---|
| Lost soul | A light left on in a room nobody has been in for 10 minutes | Turns the light off |
| Zombieman | A plug switched on but only drawing standby power (0.3 to 15 W) | Turns the plug off |
| Pinky demon | Your robot vacuum. Asleep on its dock; awake while it cleans | Waking it starts a clean. Killing it sends it home |
| Imp | Motion in a room | Nothing. It was a person. It'll be back |
| Cacodemon | A window open while the heating runs | Nothing. Go and close the window yourself |

If killing a monster doesn't fix the problem (the light didn't turn off, say), the monster comes back.

### Fly brains

If you run [HouseFly](https://github.com/Vortitron/HouseFly) (a simulated fruit-fly brain, 4,724 real neurons, living in Home Assistant), each fly walks the level as an arachnotron: a brain on legs. Its real heading steers it and its real mode decides whether it walks, grooms or sleeps.

- **Shoot it** and the real fly is *loomed*: its escape neurons fire, it bolts, and it learns to dislike where it was standing.
- **Use** it and you feed it sugar: dopamine, a good memory.
- **Kill it** and nothing happens to the fly. It's a connectome. It comes back.

Turn this off with `flies: false`.

## Install

**HACS:** add this repository as a custom repository (type *Dashboard*), install **house.wad**, then add the card to a dashboard. A panel view gives it the whole screen.

**Manual:** copy everything in a release's `dist/` folder to `config/www/housewad/`, add `/local/housewad/housewad-card.js` as a JavaScript module resource, and add the card.

```yaml
type: custom:housewad-card
```

The download is about 19 MB, nearly all of it the game's graphics and sound ([Freedoom](https://freedoom.github.io/)). It is fetched once, when you press Play.

## Practice, or for real

The card starts on a title screen with two buttons:

- **Practice** builds your house from a snapshot. Everything works, but nothing in the real house moves.
- **Play for real** controls the house, within the allowlist.

## Configuration

```yaml
type: custom:housewad-card
allow:                    # what "Play for real" may control
  - light.*
  - switch.*
  - media_player.*
  - vacuum.*
  - lock.front_door       # locks and door covers: one by one, never with *
  - cover.garage_door
exclude:                  # leave things out of the house altogether
  - switch.server_rack
skill: 3                  # 1 (I'm too young to die) to 5 (Nightmare!)
confirm_unlock: true      # ask Y/N before unlocking a lock or opening a door cover
flies: true               # HouseFly brains walk the level
rules:
  empty_minutes: 10       # a light on in an empty room this long is a lost soul
  standby_min: 0.3        # watts
  standby_max: 15         # watts
```

The default allowlist is lights, switches, media players and vacuums. Locks and door covers are never included by a pattern: `lock.*` is ignored, and the start screen says so. Name each one you want.

## Safety

- The card acts as the logged-in Home Assistant user, so it can only do what that user can do.
- Everything outside the allowlist shows up in the game but cannot be changed from it.
- Each light or plug can be switched at most once every 1.5 seconds. A chaingun on a bulb would otherwise be a strobe light, and a flood on your Zigbee network.
- Unlocking a lock or opening a door cover always asks first, in Doom's own Y/N box, unless you turn that off.
- Only the player can trigger the house. Monsters fighting each other, or an imp's fireball hitting a lamp, change nothing.

## How the level is built

Without a floor plan, each floor becomes a corridor with its rooms down both sides, and floors are joined by stairs (a basement goes down). Rooms are themed by name: kitchens are tiled, garages are concrete, gardens are open to the sky. Every light gets a lamp; switches and screens go on the walls; each lock, garage door or door sensor becomes a real door in the room's outer wall, opening onto a yard. Things with no area end up in a room called *Somewhere*.

Floor-plan import (Sweet Home 3D) and live camera feeds on in-game screens are on the way.

## Building from source

Needs [Emscripten](https://emscripten.org/) and Node 20+.

```sh
npm ci
# Freedoom 0.13.0 unpacked into third_party/freedoom-0.13.0/
npm run build      # engine, node builder, trimmed game data, card -> dist/
npm test
```

## Credits and licences

- The engine is [doomgeneric](https://github.com/ozkl/doomgeneric), a portable fork of [Chocolate Doom](https://www.chocolate-doom.org/), itself based on id Software's Doom source release. GPL-2.0.
- Levels get their BSP nodes from [ZDBSP](https://github.com/rheit/zdbsp) (GPL-2.0), compiled to WebAssembly and run in your browser.
- Graphics and sound are from [Freedoom](https://freedoom.github.io/) (BSD licence, see `dist/FREEDOOM-COPYING.txt`).
- house.wad itself is GPL-2.0-or-later.

house.wad is not affiliated with, or endorsed by, id Software, Bethesda or ZeniMax. DOOM is their trademark.

Made by [Vome](https://vome.io).
