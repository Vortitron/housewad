// house.wad: engine side of the house link. See hw_house.h.
//
// Copyright (C) 2026 Vome. GPL-2.0-or-later, like the engine it links into.

#include <math.h>
#include <string.h>

#include <emscripten.h>

#include "hw_house.h"

#include "doomdef.h"
#include "doomstat.h"
#include "d_player.h"
#include "info.h"
#include "m_random.h"
#include "p_local.h"
#include "p_mobj.h"
#include "p_spec.h"
#include "r_data.h"
#include "r_main.h"
#include "r_state.h"
#include "s_sound.h"
#include "sounds.h"
#include "z_zone.h"
#include "m_controls.h"

void M_StartMessage(char *string, void *routine, boolean input);

#define HW_MAX_SLOTS 4096

static mobj_t *slots[HW_MAX_SLOTS];

EM_JS(void, js_house_event, (int type, int a, int b, int c), {
    Module.hwEvent && Module.hwEvent(type, a, b, c);
});

static boolean ByPlayer(mobj_t *source)
{
    return source != NULL && source->player != NULL;
}

boolean HW_IsHouseSpecial(int special)
{
    return special >= HW_SPECIAL_FIRST && special <= HW_SPECIAL_LAST;
}

// Lamps never take damage: a hit is a request to switch the light off, and
// the lamp goes dark straight away. The real state, when it arrives, decides
// what the lamp shows after that. Monsters take damage as normal.
boolean HW_OnDamage(mobj_t *target, mobj_t *inflictor, mobj_t *source, int damage)
{
    if (target->type == MT_HW_LAMP)
    {
        if (ByPlayer(source))
        {
            js_house_event(HW_EV_SHOT, target->hw_slot, damage, 1);
        }
        return true;
    }

    if (target->hw_flags & HW_PUPPET)
    {
        js_house_event(HW_EV_HURT, target->hw_slot, damage, ByPlayer(source));
    }

    if (target->hw_flags & HW_DORMANT)
    {
        target->hw_flags &= ~HW_DORMANT;
        js_house_event(HW_EV_WAKE, target->hw_slot, damage, ByPlayer(source));
    }
    return false;
}

void HW_OnKill(mobj_t *source, mobj_t *target)
{
    js_house_event(HW_EV_KILL, target->hw_slot, 0, ByPlayer(source));
}

void HW_OnRemove(mobj_t *mobj)
{
    int slot = mobj->hw_slot;

    if (slot > 0 && slot < HW_MAX_SLOTS && slots[slot] == mobj)
    {
        slots[slot] = NULL;
        js_house_event(HW_EV_GONE, slot, 0, 0);
    }
    mobj->hw_slot = 0;
}

void HW_OnUseLine(mobj_t *thing, line_t *line)
{
    js_house_event(HW_EV_USE, line - lines, line->special, line->tag);
}

void HW_OnShootLine(mobj_t *thing, line_t *line)
{
    js_house_event(HW_EV_SHOOT_LINE, line - lines, line->special, line->tag);
}

void HW_ResetLevel(void)
{
    memset(slots, 0, sizeof(slots));
}

void HW_LevelReady(int map)
{
    js_house_event(HW_EV_LEVEL, map, 0, 0);
}

EM_JS(void, js_fatal, (const char *message), {
    var text = UTF8ToString(message);
    if (Module.hwFatal) Module.hwFatal(text);
    throw new Error('Doom stopped: ' + text);
});

void HW_Fatal(const char *message)
{
    emscripten_cancel_main_loop();
    js_fatal(message);
}

// Calls from JavaScript -------------------------------------------------------

static mobj_t *Slot(int slot)
{
    if (slot <= 0 || slot >= HW_MAX_SLOTS)
        return NULL;
    return slots[slot];
}

// Spawn flags
#define HW_SPAWN_FOG 1     // teleport fog and sound, for monsters appearing
#define HW_SPAWN_DORMANT 2 // ignore the player until hurt
#define HW_SPAWN_AMBUSH 4  // only wake on sight, not sound
#define HW_SPAWN_COUNT 8   // a house problem: counts on the tally screen

EMSCRIPTEN_KEEPALIVE
int hw_spawn(int slot, int type, int x, int y, int angle, int flags)
{
    mobj_t *mo;

    if (slot <= 0 || slot >= HW_MAX_SLOTS || type < 0 || type >= NUMMOBJTYPES)
        return 0;
    if (gamestate != GS_LEVEL)
        return 0;
    if (slots[slot] != NULL)
        P_RemoveMobj(slots[slot]);

    mo = P_SpawnMobj(x << FRACBITS, y << FRACBITS, ONFLOORZ, (mobjtype_t) type);
    mo->angle = ANG45 * (angle / 45);
    mo->hw_slot = slot;
    if (flags & HW_SPAWN_DORMANT)
        mo->hw_flags |= HW_DORMANT;
    if (flags & HW_SPAWN_AMBUSH)
        mo->flags |= MF_AMBUSH;
    if (flags & HW_SPAWN_FOG)
    {
        mobj_t *fog = P_SpawnMobj(mo->x, mo->y, mo->z, MT_TFOG);
        S_StartSound(fog, sfx_telept);
    }
    // Only house problems count as kills on the tally; flies and people don't.
    if (mo->flags & MF_COUNTKILL)
    {
        if (flags & HW_SPAWN_COUNT)
            totalkills++;
        else
            mo->flags &= ~MF_COUNTKILL;
    }
    slots[slot] = mo;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
void hw_remove(int slot, int fog)
{
    mobj_t *mo = Slot(slot);

    if (mo == NULL)
        return;
    if (fog)
    {
        mobj_t *f = P_SpawnMobj(mo->x, mo->y, mo->z, MT_TFOG);
        S_StartSound(f, sfx_telept);
    }
    // Fixed some other way (somebody switched the light off): not a miss.
    if ((mo->flags & MF_COUNTKILL) && mo->health > 0 && totalkills > 0)
        totalkills--;
    P_RemoveMobj(mo);
}

// 0: no such thing, 1: alive, 2: dead (a corpse)
EMSCRIPTEN_KEEPALIVE
int hw_slot_state(int slot)
{
    mobj_t *mo = Slot(slot);

    if (mo == NULL)
        return 0;
    return mo->health > 0 ? 1 : 2;
}

// Where a slot's thing is now, in map units: out[0] x, out[1] y.
EMSCRIPTEN_KEEPALIVE
int hw_slot_pos(int slot, int *out)
{
    mobj_t *mo = Slot(slot);

    if (mo == NULL)
        return 0;
    out[0] = mo->x >> FRACBITS;
    out[1] = mo->y >> FRACBITS;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
void hw_set_dormant(int slot, int dormant)
{
    mobj_t *mo = Slot(slot);

    if (mo == NULL)
        return;
    if (dormant)
    {
        mo->hw_flags |= HW_DORMANT;
        mo->target = NULL;
        if (mo->health > 0)
            P_SetMobjState(mo, mo->info->spawnstate);
    }
    else
        mo->hw_flags &= ~HW_DORMANT;
}

EMSCRIPTEN_KEEPALIVE
void hw_set_lamp(int slot, int on)
{
    mobj_t *mo = Slot(slot);

    if (mo == NULL || mo->type != MT_HW_LAMP)
        return;
    P_SetMobjState(mo, on ? S_HW_LAMP_ON : S_HW_LAMP_OFF);
    if (on)
        mo->hw_flags &= ~HW_UNLIT;
    else
        mo->hw_flags |= HW_UNLIT;
}

EMSCRIPTEN_KEEPALIVE
void hw_sector_light(int sector, int level)
{
    if (sector < 0 || sector >= numsectors)
        return;
    sectors[sector].lightlevel = level < 0 ? 0 : level > 255 ? 255 : level;
}

EMSCRIPTEN_KEEPALIVE
void hw_sector_floor(int sector, const char *flat)
{
    if (sector < 0 || sector >= numsectors)
        return;
    sectors[sector].floorpic = R_FlatNumForName((char *) flat);
}

// which: 0 middle, 1 upper, 2 lower; side: 0 front, 1 back
EMSCRIPTEN_KEEPALIVE
void hw_line_texture(int line, int side, int which, const char *name)
{
    int sidenum, tex;

    if (line < 0 || line >= numlines)
        return;
    sidenum = lines[line].sidenum[side ? 1 : 0];
    if (sidenum < 0 || sidenum >= numsides)
        return;
    tex = R_CheckTextureNumForName((char *) name);
    if (tex < 0)
        return;
    if (which == 0)
        sides[sidenum].midtexture = tex;
    else if (which == 1)
        sides[sidenum].toptexture = tex;
    else
        sides[sidenum].bottomtexture = tex;
}

// 0 closed, 1 open, 2 moving
EMSCRIPTEN_KEEPALIVE
int hw_door_state(int sector)
{
    sector_t *sec;

    if (sector < 0 || sector >= numsectors)
        return 0;
    sec = &sectors[sector];
    if (sec->specialdata)
        return 2;
    return sec->ceilingheight > sec->floorheight ? 1 : 0;
}

// Open or close a door sector. Instant moves are for setting the starting
// state when the level loads; otherwise the door runs like any Doom door.
// Returns 0 if the door is busy moving.
EMSCRIPTEN_KEEPALIVE
int hw_door(int sector, int open, int instant)
{
    sector_t *sec;
    vldoor_t *door;
    fixed_t top;

    if (sector < 0 || sector >= numsectors)
        return 0;
    sec = &sectors[sector];
    if (sec->specialdata)
        return 0;
    top = P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT;

    if (instant)
    {
        sec->ceilingheight = open ? top : sec->floorheight;
        return 1;
    }
    if (open && sec->ceilingheight >= top)
        return 1;
    if (!open && sec->ceilingheight <= sec->floorheight)
        return 1;

    door = Z_Malloc(sizeof(*door), PU_LEVSPEC, 0);
    P_AddThinker(&door->thinker);
    sec->specialdata = door;
    door->thinker.function.acp1 = (actionf_p1) T_VerticalDoor;
    door->sector = sec;
    door->type = open ? vld_open : vld_close;
    door->topwait = VDOORWAIT;
    door->speed = VDOORSPEED;
    door->topheight = top;
    door->direction = open ? 1 : -1;
    S_StartSound(&sec->soundorg, open ? sfx_doropn : sfx_dorcls);
    return 1;
}

// Show a message on the player's HUD. The text is copied.
EMSCRIPTEN_KEEPALIVE
void hw_message(const char *text)
{
    static char buffer[128];

    strncpy(buffer, text, sizeof(buffer) - 1);
    buffer[sizeof(buffer) - 1] = '\0';
    players[consoleplayer].message = buffer;
}

// Play a sound effect by name ("noway", "swtchn"), at a sector or the player.
EMSCRIPTEN_KEEPALIVE
void hw_sound(const char *name, int sector)
{
    int i;

    for (i = 1; i < NUMSFX; i++)
    {
        if (!strcasecmp(S_sfx[i].name, name))
        {
            if (sector >= 0 && sector < numsectors)
                S_StartSound(&sectors[sector].soundorg, i);
            else
                S_StartSound(NULL, i);
            return;
        }
    }
}

// The player: out[0] x, out[1] y, out[2] angle (degrees), out[3] sector,
// out[4] health, out[5] 1 if alive. Returns 0 when not in a level.
EMSCRIPTEN_KEEPALIVE
int hw_player(int *out)
{
    player_t *p = &players[consoleplayer];

    if (gamestate != GS_LEVEL || p->mo == NULL)
        return 0;
    out[0] = p->mo->x >> FRACBITS;
    out[1] = p->mo->y >> FRACBITS;
    out[2] = (int) (((unsigned long long) p->mo->angle * 360) >> 32);
    out[3] = p->mo->subsector->sector - sectors;
    out[4] = p->health;
    out[5] = p->playerstate == PST_LIVE;
    return 1;
}

// Mobj type numbers JavaScript needs, so it never hard-codes the enum.
EMSCRIPTEN_KEEPALIVE
int hw_type(const char *name)
{
    static const struct { const char *name; int type; } types[] = {
        {"lamp", MT_HW_LAMP},
        {"zombieman", MT_POSSESSED},
        {"imp", MT_TROOP},
        {"demon", MT_SERGEANT},
        {"lostsoul", MT_SKULL},
        {"cacodemon", MT_HEAD},
        {"shotgunguy", MT_SHOTGUY},
        {"arachnotron", MT_BABY},
        {"redcard", MT_MISC5},
        {"bluecard", MT_MISC4},
        {"yellowcard", MT_MISC6},
        {"redskull", MT_MISC8},
        {"blueskull", MT_MISC9},
        {"yellowskull", MT_MISC7},
        {"backpack", MT_MISC24},
        {"baron", MT_BRUISER},
        {"rocketlauncher", MT_MISC27},
        {"rockets", MT_MISC19},
        // Chores, alarms and spooky rooms (house.js wantedMonsters).
        {"mancubus", MT_FATSO},
        {"revenant", MT_UNDEAD},
        {"hellknight", MT_KNIGHT},
        {"spectre", MT_SHADOWS},
        {"cyberdemon", MT_CYBORG},
        {"chaingunner", MT_CHAINGUY},
        {"barrel", MT_BARREL},
    };
    unsigned i;

    for (i = 0; i < sizeof(types) / sizeof(*types); i++)
        if (!strcmp(types[i].name, name))
            return types[i].type;
    return -1;
}

// Put the player somewhere, facing angle degrees. For tests and recordings.
EMSCRIPTEN_KEEPALIVE
int hw_teleport(int x, int y, int angle)
{
    player_t *p = &players[consoleplayer];

    if (gamestate != GS_LEVEL || p->mo == NULL)
        return 0;
    if (!P_TeleportMove(p->mo, x << FRACBITS, y << FRACBITS))
        return 0;
    p->mo->z = p->mo->floorz;
    p->viewz = p->mo->z + p->viewheight;
    p->mo->angle = (angle_t) (((unsigned long long) (angle % 360) << 32) / 360);
    p->mo->momx = p->mo->momy = p->mo->momz = 0;
    return 1;
}

// Walk the player towards a point, a step each tic, as if they were walking
// there themselves: walls, doors and monsters stop them as usual. JavaScript
// moves the goal as the house's idea of where the person is changes (Follow).
// speed is map units per tic; 0 stops. Movement keys hand control back.
static struct
{
    int active;
    fixed_t x, y;
    int speed;
} walk_goal;

EMSCRIPTEN_KEEPALIVE
void hw_player_goal(int x, int y, int speed)
{
    walk_goal.x = x << FRACBITS;
    walk_goal.y = y << FRACBITS;
    walk_goal.speed = speed;
    walk_goal.active = speed > 0;
}

void HW_PlayerWalk(player_t *player)
{
    mobj_t *mo = player->mo;
    ticcmd_t *cmd = &player->cmd;
    double dx, dy, dist, step;

    if (!walk_goal.active || mo == NULL || player->playerstate != PST_LIVE)
        return;
    if (cmd->forwardmove || cmd->sidemove)
    {
        walk_goal.active = 0;
        js_house_event(HW_EV_TAKEOVER, 0, 0, 0);
        return;
    }
    dx = (double) (walk_goal.x - mo->x) / FRACUNIT;
    dy = (double) (walk_goal.y - mo->y) / FRACUNIT;
    dist = sqrt(dx * dx + dy * dy);
    if (dist < 6)
        return;
    // Slow down for the last few steps rather than overshoot.
    step = dist / 6 < walk_goal.speed ? dist / 6 : walk_goal.speed;
    mo->momx = (fixed_t) (dx / dist * step * FRACUNIT);
    mo->momy = (fixed_t) (dy / dist * step * FRACUNIT);
    // Face the way we walk, turning gently; the mouse still turns freely.
    if (!cmd->angleturn && dist > 24)
    {
        angle_t want = R_PointToAngle2(mo->x, mo->y, walk_goal.x, walk_goal.y);
        mo->angle += (angle_t) ((int) (want - mo->angle) / 10);
    }
    if (mo->state == &states[S_PLAY])
        P_SetMobjState(mo, S_PLAY_RUN1);
}

// Damage a slot's thing as if the player had shot it. For tests.
EMSCRIPTEN_KEEPALIVE
int hw_debug_damage(int slot, int damage)
{
    mobj_t *mo = Slot(slot);
    mobj_t *player = players[consoleplayer].mo;

    if (mo == NULL || player == NULL || !(mo->flags & MF_SHOOTABLE))
        return 0;
    P_DamageMobj(mo, player, player, damage);
    return 1;
}

// Ask the player a yes/no question in Doom's own message box (the one that
// asks whether you really want to quit). The game pauses while it is up.
static int confirm_token;

static void HW_ConfirmResponse(int key)
{
    js_house_event(HW_EV_CONFIRM, confirm_token, key == key_menu_confirm, 0);
}

EMSCRIPTEN_KEEPALIVE
void hw_confirm(const char *text, int token)
{
    static char buffer[256];

    strncpy(buffer, text, sizeof(buffer) - 1);
    buffer[sizeof(buffer) - 1] = '\0';
    confirm_token = token;
    M_StartMessage(buffer, HW_ConfirmResponse, true);
}

// Puppets ---------------------------------------------------------------------

static angle_t DegreesToAngle(int degrees)
{
    degrees %= 360;
    if (degrees < 0)
        degrees += 360;
    return (angle_t) (((unsigned long long) degrees << 32) / 360);
}

static boolean PuppetStep(mobj_t *actor, angle_t angle)
{
    fixed_t step = actor->hw_speed << FRACBITS;
    unsigned fine = angle >> ANGLETOFINESHIFT;

    return P_TryMove(actor, actor->x + FixedMul(step, finecosine[fine]),
                     actor->y + FixedMul(step, finesine[fine]));
}

// One chase step for a puppet: turn towards the heading it was given (at most
// 45 degrees a step, so it looks like walking, not snapping), then walk. A
// wall makes it slide along by trying the nearest open angle instead.
void HW_PuppetChase(mobj_t *actor)
{
    static const int tries[] = {45, -45, 90, -90, 135, -135, 180};
    angle_t want = DegreesToAngle(actor->hw_heading);
    angle_t diff = want - actor->angle;
    unsigned i;

    if (actor->hw_speed <= 0)
    {
        P_SetMobjState(actor, actor->info->spawnstate);
        return;
    }
    if (diff < ANG180)
        actor->angle += diff > ANG45 ? ANG45 : diff;
    else
        actor->angle -= (angle_t) -diff > ANG45 ? ANG45 : (angle_t) -diff;

    if (PuppetStep(actor, actor->angle))
        return;
    for (i = 0; i < sizeof(tries) / sizeof(*tries); i++)
    {
        angle_t a = actor->angle + DegreesToAngle(tries[i]);
        if (PuppetStep(actor, a))
        {
            actor->angle = a;
            return;
        }
    }
}

// Steer a slot's thing. speed 0 stands it still; enable 0 hands it back to
// Doom's own AI.
EMSCRIPTEN_KEEPALIVE
void hw_puppet(int slot, int enable, int heading, int speed)
{
    mobj_t *mo = Slot(slot);

    if (mo == NULL || mo->health <= 0)
        return;
    if (!enable)
    {
        mo->hw_flags &= ~HW_PUPPET;
        return;
    }
    mo->hw_flags |= HW_PUPPET;
    mo->hw_flags &= ~HW_DORMANT;
    mo->hw_heading = heading;
    mo->hw_speed = speed;
    mo->target = NULL;
    if (speed > 0 && mo->state == &states[mo->info->spawnstate])
        P_SetMobjState(mo, mo->info->seestate);
}

void HW_LevelExit(void)
{
    js_house_event(HW_EV_EXIT, gamemap, players[consoleplayer].killcount, totalkills);
}

// What the player is aiming at -------------------------------------------------
//
// out[0] slot of the house thing in the sights (0 none), out[1] its distance;
// out[2] the first house or exit line along the view (-1 none), out[3] its
// distance. Walls and closed doors stop the line search, so nothing behind
// them counts.

static int aim_line;
static fixed_t aim_frac;

static boolean PTR_HwAim(intercept_t *in)
{
    line_t *li = in->d.line;

    if (HW_IsHouseSpecial(li->special) || li->special == 11 || li->special == 51 || li->special == 52)
    {
        aim_line = li - lines;
        aim_frac = in->frac;
        return false;
    }
    if (!(li->flags & ML_TWOSIDED))
        return false;
    P_LineOpening(li);
    return openrange > 0;
}

EMSCRIPTEN_KEEPALIVE
int hw_aim(int *out)
{
    player_t *p = &players[consoleplayer];
    mobj_t *mo = p->mo;
    fixed_t range = 1024 * FRACUNIT;
    unsigned fine;

    out[0] = 0;
    out[1] = 0;
    out[2] = -1;
    out[3] = 0;
    if (gamestate != GS_LEVEL || mo == NULL)
        return 0;
    P_AimLineAttack(mo, mo->angle, range);
    if (linetarget != NULL && linetarget->hw_slot)
    {
        out[0] = linetarget->hw_slot;
        out[1] = P_AproxDistance(linetarget->x - mo->x, linetarget->y - mo->y) >> FRACBITS;
    }
    aim_line = -1;
    fine = mo->angle >> ANGLETOFINESHIFT;
    P_PathTraverse(mo->x, mo->y, mo->x + FixedMul(range, finecosine[fine]),
                   mo->y + FixedMul(range, finesine[fine]), PT_ADDLINES, PTR_HwAim);
    if (aim_line >= 0)
    {
        out[2] = aim_line;
        out[3] = FixedMul(aim_frac, range) >> FRACBITS;
    }
    return 1;
}

// The level's name on the automap ("MAP01: <your home>").
extern char *mapnames_commercial[];

EMSCRIPTEN_KEEPALIVE
void hw_level_title(const char *text)
{
    static char buffer[64];

    strncpy(buffer, text, sizeof(buffer) - 1);
    buffer[sizeof(buffer) - 1] = '\0';
    mapnames_commercial[0] = buffer;
}
