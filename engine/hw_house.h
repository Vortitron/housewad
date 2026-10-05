// house.wad: the link between the Doom world and the real house.
//
// Things that stand for house objects carry a slot number (mobj->hw_slot)
// chosen by the JavaScript side, which also owns every decision about what
// an event means in the real house. The engine only reports and obeys.

#ifndef HW_HOUSE_H
#define HW_HOUSE_H

#include "doomtype.h"

struct mobj_s;
struct line_s;

// Line specials the generated map uses for house fixtures.
#define HW_SPECIAL_FIRST 900
#define HW_SPECIAL_LAST 999

// mobj->hw_flags
#define HW_DORMANT 1 // ignores the player until hurt (a docked vacuum)
#define HW_PUPPET 2  // steered from JavaScript (a fly brain), never attacks

// Events sent to JavaScript: Module.hwEvent(type, a, b, c)
enum
{
    HW_EV_LEVEL = 1,  // a: map number. Spawn the house again.
    HW_EV_SHOT = 2,   // a: slot, b: damage, c: 1 if the player did it
    HW_EV_WAKE = 3,   // a: slot, c: 1 if the player did it
    HW_EV_KILL = 4,   // a: slot, c: 1 if the player did it
    HW_EV_GONE = 5,   // a: slot (removed from the world)
    HW_EV_USE = 6,    // a: line index, b: special, c: line tag
    HW_EV_SHOOT_LINE = 7, // a: line index, b: special, c: line tag
    HW_EV_CONFIRM = 8, // a: token, b: 1 for yes
    HW_EV_HURT = 9,    // a: slot, b: damage, c: 1 if the player did it (puppets only)
    HW_EV_EXIT = 10,   // the player left the level by the exit
};

boolean HW_IsHouseSpecial(int special);
boolean HW_OnDamage(struct mobj_s *target, struct mobj_s *inflictor, struct mobj_s *source, int damage);
void HW_OnKill(struct mobj_s *source, struct mobj_s *target);
void HW_OnRemove(struct mobj_s *mobj);
void HW_OnUseLine(struct mobj_s *thing, struct line_s *line);
void HW_OnShootLine(struct mobj_s *thing, struct line_s *line);
void HW_ResetLevel(void);
void HW_LevelReady(int map);
void HW_Fatal(const char *message);
void HW_PuppetChase(struct mobj_s *actor);
void HW_LevelExit(void);

#endif
