// house.wad web platform layer for doomgeneric.
//
// Video: each finished frame is handed to JavaScript as a pointer into the
// 32-bit XRGB framebuffer (320x200); the page blits it to a canvas.
// Input: JavaScript posts Doom events directly (keys and mouse), so the page
// owns every DOM listener and nothing grabs keys outside the game.
// Sound: sound effects are passed to JavaScript as the raw DMX lump, which
// decodes and plays them with WebAudio. Music is not played.
//
// Copyright (C) 2026 Vome. GPL-2.0-or-later, like the engine it links into.

#include <stdio.h>
#include <string.h>

#include <emscripten.h>

#include "doomgeneric.h"
#include "doomkeys.h"
#include "d_event.h"
#include "i_sound.h"
#include "w_wad.h"
#include "z_zone.h"

EM_JS(void, js_present, (const void *pixels, int width, int height), {
    Module.hwPresent && Module.hwPresent(pixels, width, height);
});

EM_JS(void, js_sound_start, (int lump, const void *data, int len, int channel, int vol, int sep), {
    Module.hwSoundStart && Module.hwSoundStart(lump, data, len, channel, vol, sep);
});

EM_JS(void, js_sound_update, (int channel, int vol, int sep), {
    Module.hwSoundUpdate && Module.hwSoundUpdate(channel, vol, sep);
});

EM_JS(void, js_sound_stop, (int channel), {
    Module.hwSoundStop && Module.hwSoundStop(channel);
});

EM_JS(int, js_sound_playing, (int channel), {
    return Module.hwSoundPlaying ? (Module.hwSoundPlaying(channel) ? 1 : 0) : 0;
});

void DG_Init(void)
{
}

void DG_DrawFrame(void)
{
    js_present(DG_ScreenBuffer, DOOMGENERIC_RESX, DOOMGENERIC_RESY);
}

// The browser cannot block; the loop in TryRunTics returns instead of
// sleeping (see d_loop.c), so a sleep is never needed here.
void DG_SleepMs(uint32_t ms)
{
}

uint32_t DG_GetTicksMs(void)
{
    return (uint32_t) emscripten_get_now();
}

// Keys arrive through hw_post_event, never through the doomgeneric queue.
int DG_GetKey(int *pressed, unsigned char *key)
{
    return 0;
}

void DG_SetWindowTitle(const char *title)
{
}

EMSCRIPTEN_KEEPALIVE
void hw_post_event(int type, int data1, int data2, int data3)
{
    event_t event;

    event.type = (evtype_t) type;
    event.data1 = data1;
    event.data2 = data2;
    event.data3 = data3;
    D_PostEvent(&event);
}

EMSCRIPTEN_KEEPALIVE
void hw_stop(void)
{
    emscripten_cancel_main_loop();
}

// Sound effects -------------------------------------------------------------

static boolean sfx_prefix;

static snddevice_t web_sound_devices[] = {
    SNDDEVICE_SB, SNDDEVICE_PAS, SNDDEVICE_GUS,
    SNDDEVICE_WAVEBLASTER, SNDDEVICE_SOUNDCANVAS, SNDDEVICE_AWE32,
};

static boolean WebSound_Init(boolean use_sfx_prefix)
{
    sfx_prefix = use_sfx_prefix;
    return true;
}

static void WebSound_Shutdown(void)
{
}

static int WebSound_GetSfxLumpNum(sfxinfo_t *sfx)
{
    char name[9];

    if (sfx->link != NULL)
        sfx = sfx->link;

    if (sfx_prefix)
        snprintf(name, sizeof(name), "ds%s", sfx->name);
    else
        snprintf(name, sizeof(name), "%s", sfx->name);

    return W_CheckNumForName(name);
}

static void WebSound_Update(void)
{
}

static void WebSound_UpdateSoundParams(int channel, int vol, int sep)
{
    js_sound_update(channel, vol, sep);
}

static int WebSound_StartSound(sfxinfo_t *sfx, int channel, int vol, int sep)
{
    int lump = sfx->lumpnum;
    byte *data;

    if (lump < 0)
        return -1;

    data = W_CacheLumpNum(lump, PU_STATIC);
    js_sound_start(lump, data, W_LumpLength(lump), channel, vol, sep);
    return channel;
}

static void WebSound_StopSound(int channel)
{
    js_sound_stop(channel);
}

static boolean WebSound_SoundIsPlaying(int channel)
{
    return js_sound_playing(channel) != 0;
}

static void WebSound_CacheSounds(sfxinfo_t *sounds, int num_sounds)
{
}

sound_module_t DG_sound_module = {
    web_sound_devices,
    sizeof(web_sound_devices) / sizeof(*web_sound_devices),
    WebSound_Init,
    WebSound_Shutdown,
    WebSound_GetSfxLumpNum,
    WebSound_Update,
    WebSound_UpdateSoundParams,
    WebSound_StartSound,
    WebSound_StopSound,
    WebSound_SoundIsPlaying,
    WebSound_CacheSounds,
};

// Music: silent ---------------------------------------------------------------

static boolean WebMusic_Init(void) { return true; }
static void WebMusic_Shutdown(void) {}
static void WebMusic_SetVolume(int volume) {}
static void WebMusic_Pause(void) {}
static void WebMusic_Resume(void) {}
static void *WebMusic_Register(void *data, int len) { return (void *) 1; }
static void WebMusic_UnRegister(void *handle) {}
static void WebMusic_Play(void *handle, boolean looping) {}
static void WebMusic_Stop(void) {}
static boolean WebMusic_IsPlaying(void) { return false; }
static void WebMusic_Poll(void) {}

music_module_t DG_music_module = {
    web_sound_devices,
    sizeof(web_sound_devices) / sizeof(*web_sound_devices),
    WebMusic_Init,
    WebMusic_Shutdown,
    WebMusic_SetVolume,
    WebMusic_Pause,
    WebMusic_Resume,
    WebMusic_Register,
    WebMusic_UnRegister,
    WebMusic_Play,
    WebMusic_Stop,
    WebMusic_IsPlaying,
    WebMusic_Poll,
};

int main(int argc, char **argv)
{
    doomgeneric_Create(argc, argv);
    emscripten_set_main_loop(doomgeneric_Tick, 0, 0);
    return 0;
}

// Stubs for the SDL-backed pieces this build leaves out ----------------------

int use_libsamplerate = 0;
float libsamplerate_scale = 0.65f;

void I_InitJoystick(void) {}
void I_BindJoystickVariables(void) {}
