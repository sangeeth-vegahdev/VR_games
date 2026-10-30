# Cricket Catch (Meta Quest, hand tracking)

A coach swings a bat, a cricket ball flies at you (it swings in the air and gets faster each ball),
and you catch it with your hands. 6 balls per round. Built with Unity 6 and the Meta XR Core SDK.
No paid or external assets: the whole scene is generated from free Unity primitives.

## 1. Install (one time)

1. Unity Hub, then install **Unity 6000.0.66f2 or newer** with the modules
   **Android Build Support**, **OpenJDK**, **Android SDK & NDK Tools**.
2. In Unity Hub create a new project from the **3D (URP)** template named `CricketCatch`.
   If Hub refuses to use this folder because it is not empty, create the project somewhere else
   and copy this repo's `CricketCatch/Assets` folder into it, replacing the project's `Assets`.
3. In Unity: **Window > Package Manager > My Assets**, install **Meta XR Core SDK**
   (the SDK is free; add it to your assets from the Unity Asset Store first).
   The scripts reference `OVRHand`, so the SDK must be imported even for PC testing.
4. **Edit > Project Settings > Player > Other Settings > Active Input Handling = Both**
   (the PC test mode uses the classic Input class). Unity restarts.

## 2. Build the scene and test on PC

1. **Tools > Cricket Catch > Build Scene**. This creates `Assets/Scenes/CricketCatch.unity`.
2. Press **Play**. The yellow ball follows your mouse: move it into the incoming ball to catch it.
3. After 6 balls, move the mouse zone onto the green ball (or press Space) to play again.

Tuning (select **Ball Launcher** in the scene): start speed, speed increase per ball, max speed,
swing, swing increase per ball, target spread.

## 3. Run on Quest with real hands

1. **Tools > Cricket Catch > Add Quest Camera Rig** (adds Meta's `OVRCameraRig`, disables the PC camera).
2. On the rig's **OVRManager**: Tracking Origin Type = **Floor Level**, Hand Tracking Support =
   **Controllers and Hands** (or Hands Only).
3. Add hands: **Meta > Tools > Building Blocks**, add the **Hand Tracking** block.
   The game finds the `OVRHand` objects automatically and puts a catch zone on each palm.
4. **Meta > Tools > Project Setup Tool**, apply all fixes.
5. **File > Build Profiles** (Build Settings), switch to **Android**, select your Quest, **Build And Run**.

## Tuning hand catches on device

`Hand Catch Zones` object: `Palm Radius` (bigger is more forgiving) and `Palm Offset` (move the zone
to the middle of the palm). `Tracking Grace` keeps the zone alive briefly if tracking drops out.

## Scripts

| Script | Job |
|---|---|
| `Core/GameManager` | States READY, THROWING, CAUGHT, MISSED, ROUND_OVER, score, balls per round, restart |
| `Gameplay/BallLauncher` | Aims and throws the ball; speed and swing both ramp up per ball |
| `Gameplay/Ball` | Swing force, miss detection, one-time scoring guard |
| `Gameplay/CoachSwing` | Code-driven bat swing, no animation asset |
| `Catching/CatchZone` | Trigger sphere that catches the ball (mouse and palms) |
| `Catching/HandCatchZones` | Palm zones that follow tracked `OVRHand`s (Quest only) |
| `Catching/RestartTarget` | Touch to play again (works with hands) |
| `Input/DebugMouseCatcher` | PC test input, disabled on Android |
| `Effects/FeedbackFx` | Generated sounds and particle burst, no audio assets |
| `UI/ScoreUI` | World-space HUD (screen-space UI does not show in a headset) |
| `Editor/SceneBuilder` | One-click scene and Quest rig tools |

## Not yet verified

This code was written without access to the Unity Editor, so it has not been compiled or run.
Expect to fix small compile or API-name errors on first open (paste them to Claude).
Hand-tracking behaviour and catch-zone sizes need tuning on a real Quest.

## Optional free upgrades (check each license on the source page)

CC0 packs from Kenney, Quaternius and KayKit can replace the primitive coach, bat and stands.
