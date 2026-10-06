# house.wad

**Your house, as a Doom level. Shooting the lamp turns off the light.**

[![house.wad: shoot the lamp in Doom and the real light goes off; the spider is a real fruit-fly brain; the front door asks Y/N before it unlocks](https://housefly.vome.io/media/housewad-readme.gif)](https://housefly.vome.io/media/housewad-demo.mp4)

*Click for the full 42-second video: the lamp, a fruit-fly brain, the front door, the robot vacuum, a camera on the wall, and the tally screen.*

house.wad is a Home Assistant dashboard card. It reads your floors, areas and devices, builds a Doom level out of them, and runs the real Doom engine in the card. What you do in the game happens in the house, and what happens in the house shows up in the game.

## Quick start

1. **Install it with HACS.** [![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Vortitron&repository=housewad&category=plugin) Or in HACS: ⋮ → *Custom repositories* → `https://github.com/Vortitron/housewad`, type *Dashboard*. Then **Download**.
2. **Add the card.** Edit a dashboard → *Add card* → **house.wad**. It is best in a view of its own set to *Panel*, so it gets the whole screen.
3. **Press Practice.** Your house as a Doom level, and nothing in the real house moves.
4. **Play for real.** Open the card's settings (the pencil, then the card) and tick what the game may control. Start with Lights. Then press **Play for real** and shoot a lamp.

Not ready to put it on your own house? **[Play the demo house](https://housefly.vome.io/housewad)**: no account, nothing to install.

## Try it

**[housefly.vome.io/housewad](https://housefly.vome.io/housewad)** signs you straight into a demo house and its house.wad dashboard: the game on the left, the devices it is changing on the right. Press **Play for real**. Everything in it is simulated, and everyone who visits shares the same house, so the lamp you shoot is off for them too.

**[housefly.vome.io/swarm](https://housefly.vome.io/swarm)** is a second house with four fruit-fly brains living in it; open **house.wad** from the sidebar.

Both run on [Vome](https://vome.io) hosting. The guest sign-ins are renewed monthly; if one has lapsed, open an issue.

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
| A camera in a room | A screen on that room's wall shows its live picture |
| A tagged thing (Bermuda or ESPresense) | A keycard lying in the room it's really in. Pick it up: "Found: Car Keys. It's in the Kitchen." |
| The exit switch by the start | Doom's tally screen, named after your home: kills are the problems you fixed. Runs `exit_scene` if set |
| Type a cheat code | `idbeholdl` turns every allowed light on; your own codes run your scenes and scripts |

Under the game, a status line shows the room you're in, what you're aiming at (and its state), and the last thing that happened.

### The house's problems are demons

| Monster | What it is | Killing it |
|---|---|---|
| Lost soul | A light left on in a room nobody has been in for 10 minutes | Turns the light off |
| Zombieman | A plug switched on but only drawing standby power (0.3 to 15 W) | Turns the plug off |
| Pinky demon | Your robot vacuum. Asleep on its dock; awake while it cleans, in whichever room it reports | Waking it starts a clean. Killing it sends it home |
| Imp | Motion in a room, or a person whose phone [Bermuda](https://github.com/agittins/bermuda) has in it (named after them) | Nothing. It was a person. It'll be back |
| Cacodemon | A window open while the heating runs | Nothing. Go and close the window yourself |
| Revenant | A dishwasher or washing machine that has finished: clean things waiting | Nothing. Go and empty it |
| Hell knight | An appliance's door left open while it isn't running | Nothing. Go and shut it |
| Mancubus | Something hungry: dishwasher salt or rinse aid nearly empty, coffee beans, pellets, toner or ink below 20% | Nothing until you refill it |
| Cyberdemon | A smoke, gas or carbon monoxide alarm going off, in the room it's in | Nothing. Go and look |
| Spectre | A room called spooky or haunted (it's dim in there too) | It was only the wind |

Appliances are found by what their sensors are called, the way Home Connect, Miele and others name them (`_operation_state`, `_programme_finished`, `_door`, `_salt_nearly_empty`), so no setup is needed.

If killing a monster doesn't fix the problem (the light didn't turn off, say), the monster comes back.

**People, by Bluetooth.** Turn on the Home Assistant Companion app's *BLE Transmitter* on a phone (Settings → Companion app → Manage sensors), and pick its iBeacon in Bermuda's *Select Devices*. The game finds the phone from the beacon id and names it after the person it belongs to. A room with someone in it is occupied. A room only counts as empty, for the wasted-light rule, if everyone in Home Assistant is followed this way or away from home: otherwise a lamp someone is reading by could be shot out from under them. A wall tablet running Fully Kiosk is a screen, not a person.

A tablet can be a listener for a room with no Bluetooth proxy. The Companion app's *Beacon monitor* reports how far away each beacon it hears is, and a phone within 3 m of the tablet is in the tablet's room, whatever Bermuda's nearest proxy says. Put the tablet's device in an area, or name it in a plan room: `listeners: [sensor.hall_tablet_beacon_monitor]`, `near: 3`. A reading more than a minute old is ignored (the app does not update it often), so a tablet never pins anyone to a room they have left.

**Follow.** With a phone followed, the game bar has a *Follow* button: on, you are taken to the room your phone is in, once it has stayed there a few seconds (Bermuda flips between neighbouring rooms, and a flip is not a move). It follows the phone of the person you are logged in as; set `follow: pixel_8` (a phone) or `follow: false` in the card, or choose in its settings.

**Where in the room.** Inside the room, Follow walks you to where the phone seems to be rather than jumping there:
- *Bluetooth:* turn on Bermuda's *Distance to …* sensors for the phone (Bermuda creates them switched off) and the game finds the point that best fits every listener's distance, nearer listeners counting for more, kept inside the room and smoothed into a walk. Tell the plan where the listeners are (`scanners: { BedroomLights: [11.2, 12.5] }`); one without a position counts as the middle of its room.
- *Radar:* an HLK-LD2410 (distance only: you are placed that far straight in front of it) or an LD2450 (x and y of up to three people) is better still. Give its spot and the way it faces on the plan (`radars: [{ radar: allrum_motion, at: [12.5, 6.3], facing: 0 }]`; facing 0 is east, 90 south).
- Press a movement key and you take over; Follow picks up again 20 seconds later. Other people Bermuda follows are imps that walk to where they are, and don't fight.

### The outside world

If the home watches public switches from [sync.vome.io](https://sync.vome.io) (the [Vome](https://github.com/Vortitron/VomeSync) integration's shared switches, which follow real things: bridges opening, services going down, earthquakes, rocket launches), the level hears about them:

| Out there | In the game |
|---|---|
| A service goes down ("GitHub is up" turns off) | A Baron of Hell called "GitHub is down" turns up. Killing it won't bring GitHub back; it leaves when GitHub does |
| A significant earthquake, volcano, hurricane or flood alert | Every room's lights shake |
| A geomagnetic storm | An aurora over the yards and the garden |
| An orbital launch window | A rocket launcher by the start, while the window is open |
| A bridge opens, or the Underground is disrupted | The corridor lights flicker |
| Anything else | A line on the HUD and the status line |

Watched switches are read only. Switches the home owns are left out of the game entirely.

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

## In Claude Code, in a terminal

The same game runs in a Claude Code pane, drawn in coloured half blocks, with the
[vome-doom](https://github.com/Vortitron/home-assistant-mcp/tree/main/claude-plugin/vome-doom)
plugin. It reads your home through the Vome MCP, runs the engine under Node
(`dist/housewad-term.mjs`, see `host/terminal.js`) and makes the game's calls on
your house through the MCP too:

```
/plugin install vome-doom --marketplace Vortitron/home-assistant-mcp
/doom
```

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
exit_scene: scene.leaving_home   # the exit switch runs this
cheats:                   # type the code in the game, run the thing
  idcoffee: script.make_coffee
  idgoodnight: scene.goodnight
rules:
  empty_minutes: 10       # a light on in an empty room this long is a lost soul
  standby_min: 0.3        # watts
  standby_max: 15         # watts
```

**To change what it may control, edit the card** (pencil at the top right of the dashboard, then the card): tick lights, switches and plugs, media players, vacuums, each lock or door you want, and any switch the safety check left alone. The YAML below is the same thing written out.

The default allowlist is lights, switches, media players and vacuums. Locks and door covers are never included by a pattern: `lock.*` is ignored, and the start screen says so. Name each one you want.

## Safety

- The card acts as the logged-in Home Assistant user, so it can only do what that user can do.
- Everything outside the allowlist shows up in the game but cannot be changed from it.
- A switch that looks like it matters is never reached by a pattern such as `switch.*`. That means its name (freezer, boiler, hot water, pump, router, dishwasher, battery, VM and the like), the integration behind it (hypervisors, NAS, PDUs and UPSes, network gear, appliances, solar, batteries, EV chargers) or its room (comms, server, network, rack, plant room). Tick it in the card's settings (or name it exactly in `allow`) if you really mean it. (The name list started from [HouseFly](https://github.com/Vortitron/HouseFly)'s safety layer.)
- On a real house, start with only Lights ticked and Practice, then add what you want. The start screen says how many things a real game can reach, and the card's settings list the switches it leaves alone.
- Each light or plug can be switched at most once every 1.5 seconds. A chaingun on a bulb would otherwise be a strobe light, and a flood on your Zigbee network.
- Unlocking a lock or opening a door cover always asks first, in Doom's own Y/N box, unless you turn that off.
- Only the player can trigger the house. Monsters fighting each other, or an imp's fireball hitting a lamp, change nothing.

## How the level is built

The level is built when you press Practice or Play for real; while you play, states (lights, doors, the vacuum, cameras) follow the house live. A device you add to Home Assistant during a game is announced ("New in the house: …") and appears in the next one.

A camera or media player in an outside area gets its screen on the wall inside the door that leads out there, like a door entry screen, since a yard has little wall to hang one on.

Without a floor plan, each floor becomes a corridor with its rooms down both sides, and floors are joined by stairs (a basement goes down). Rooms are themed by name: kitchens are tiled, garages are concrete, gardens are open to the sky. Every light gets a lamp; switches and screens go on the walls; each lock, garage door or door sensor becomes a real door in the room's outer wall, opening onto a yard. Things with no area end up in a room called *Somewhere*.

### Your real floor plan

Give the card a `floorplan` and it builds the house as it really is instead: each room's shape as rectangles in metres, the doors between rooms, the doors out, and ceiling heights. Rooms are matched to Home Assistant areas by `area`, so each area's lamps, switches, screens and doors land in its room; areas the plan has no room for go in an annex off the garden.

```yaml
floorplan:
  rooms:
    - { id: hall, name: Hall, area: hall, height: 2.4, rects: [[0, 0, 6, 3], [0, 3, 3, 6]] }
    - { id: kitchen, name: Kitchen, area: kitchen, rects: [[6, 0, 10, 4]] }
    - { id: cinema, name: Cinema, area: cinema, height: 4, rects: [[0, 6, 10, 12]] }
  open: [[hall, kitchen]]            # rooms with no wall where they meet
  doors:
    - { rooms: [hall, cinema], at: [[1, 6], [2, 6]] }   # two points on the wall
  exits:
    - { room: hall, name: Front door, at: [[0, 1], [0, 2]], outside: front_garden, door: lock.front_door }
  start: { room: hall, at: [1.5, 1.5] }
```

More than one storey: Doom can't put a room above another, so each other level sits beside the house, at its own height, and stairs join them. A stair climbs (or drops) a few steps from the room's edge, then teleports you to the matching stairwell on the other level, which you walk out of into the room. To your feet it is one staircase.

```yaml
  levels:
    loft: { offset: [0, -9], floor: 2.7 }      # metres: where it sits on the map, how high
  rooms:
    - { id: loft, area: loft, level: loft, rects: [[10, 0, 18, 3.5]] }
  stairs:
    - name: Stairs to the loft
      from: { room: living, rect: [14.6, 3.6, 15.6, 4.9], enter: s }   # entered from the room to its south
      to:   { room: loft,   rect: [14.6, 3.5, 15.6, 4.9], enter: n }
  anywhere: [residence]    # areas that mean the whole house: their things are spread over the rooms
  # A room can ask for props: barrel, candle, candelabra, lamp, skulls, blood.
  #   - { id: spooky, name: Spooky toilet, rects: [...], things: [barrel, barrel, candle] }
```

The plan lives in the card's config rather than in a file under `/local`, because `/local` is served without a login and a floor plan is not something to publish. Sweet Home 3D import is on the way.

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
