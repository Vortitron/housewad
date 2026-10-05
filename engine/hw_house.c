// house.wad: engine side of the house link. See hw_house.h.
//
// Copyright (C) 2026 Vome. GPL-2.0-or-later, like the engine it links into.

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
#include "r_state.h"
#include "s_sound.h"
#include "sounds.h"
#include "z_zone.h"

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
