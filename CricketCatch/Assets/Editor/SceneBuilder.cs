using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

// One-click scene generation: Tools > Cricket Catch > Build Scene.
// Everything is built from free Unity primitives, so there are no external assets to import.
public static class SceneBuilder
{
    private const string ScenePath = "Assets/Scenes/CricketCatch.unity";
    private const string MaterialsFolder = "Assets/Materials";

    private static readonly Color Sky = new Color(0.55f, 0.76f, 0.95f);

    [MenuItem("Tools/Cricket Catch/Build Scene")]
    public static void Build()
    {
        Scene scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
        Directory.CreateDirectory(MaterialsFolder);
        Directory.CreateDirectory("Assets/Scenes");

        BuildLighting();
        BuildField();
        BuildStadium();
        CoachSwing coach = BuildCoach();
        ScoreUI ui = BuildHud(out GameObject roundOverPanel);
        BuildGameplay(coach, ui);

        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        AssetDatabase.SaveAssets();
        Debug.Log("Cricket scene built: " + ScenePath + ". Press Play.");
    }

    // Swaps the PC camera for Meta's OVRCameraRig (needs Meta XR Core SDK imported).
    [MenuItem("Tools/Cricket Catch/Add Quest Camera Rig")]
    public static void AddQuestRig()
    {
        GameObject prefab = null;
        foreach (string guid in AssetDatabase.FindAssets("OVRCameraRig t:Prefab"))
        {
            string path = AssetDatabase.GUIDToAssetPath(guid);
            if (path.EndsWith("/OVRCameraRig.prefab")) prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        }

        if (prefab == null)
        {
            Debug.LogError("OVRCameraRig prefab not found. Import the Meta XR Core SDK first.");
            return;
        }

        if (Camera.main != null && Camera.main.GetComponentInParent<OVRCameraRig>() == null)
        {
            Camera.main.gameObject.SetActive(false);
        }

        var rig = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        rig.transform.position = Vector3.zero;
        Selection.activeGameObject = rig;
        Debug.Log("OVRCameraRig added. In OVRManager set Tracking Origin to Floor Level and Hand Tracking Support to Hands Only (or Controllers and Hands).");
    }

    private static void BuildLighting()
    {
        Camera cam = Camera.main;
        cam.transform.SetPositionAndRotation(new Vector3(0f, 1.6f, 0f), Quaternion.identity);
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = Sky;

        Light sun = UnityEngine.Object.FindFirstObjectByType<Light>();
        sun.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
        sun.color = new Color(1f, 0.96f, 0.88f);
        sun.intensity = 1.1f;

        RenderSettings.fog = true;
        RenderSettings.fogMode = FogMode.Linear;
        RenderSettings.fogColor = Sky;
        RenderSettings.fogStartDistance = 45f;
        RenderSettings.fogEndDistance = 130f;
    }

    private static void BuildField()
    {
        GameObject ground = Primitive(PrimitiveType.Plane, "Ground", null, new Vector3(0f, 0f, 10f), new Vector3(12f, 1f, 12f), "Grass", new Color(0.2f, 0.5f, 0.22f));
        GameObjectUtility.SetStaticEditorFlags(ground, StaticEditorFlags.BatchingStatic);

        // Mowing stripes.
        for (int i = 0; i < 13; i++)
        {
            bool light = i % 2 == 0;
            Decor(PrimitiveType.Cube, "Stripe " + i, null, new Vector3(-24f + 4f * i, 0.003f, 10f), new Vector3(4f, 0.004f, 52f),
                light ? "GrassLight" : "GrassDark", light ? new Color(0.27f, 0.58f, 0.27f) : new Color(0.2f, 0.5f, 0.22f));
        }

        Decor(PrimitiveType.Cube, "Pitch", null, new Vector3(0f, 0.006f, 9f), new Vector3(3f, 0.006f, 21f), "Pitch", new Color(0.82f, 0.7f, 0.48f));
        Decor(PrimitiveType.Cube, "Crease Coach", null, new Vector3(0f, 0.012f, 17f), new Vector3(3f, 0.004f, 0.06f), "Line", Color.white);
        Decor(PrimitiveType.Cube, "Crease Player", null, new Vector3(0f, 0.012f, 1f), new Vector3(3f, 0.004f, 0.06f), "Line", Color.white);

        // Stumps behind the coach.
        for (int i = -1; i <= 1; i++)
        {
            Decor(PrimitiveType.Cylinder, "Stump", null, new Vector3(0.1f * i, 0.36f, 19.2f), new Vector3(0.04f, 0.36f, 0.04f), "Stump", new Color(0.9f, 0.82f, 0.6f));
        }
        Decor(PrimitiveType.Cube, "Bail", null, new Vector3(-0.05f, 0.73f, 19.2f), new Vector3(0.1f, 0.02f, 0.02f), "Stump", new Color(0.9f, 0.82f, 0.6f));
        Decor(PrimitiveType.Cube, "Bail", null, new Vector3(0.05f, 0.73f, 19.2f), new Vector3(0.1f, 0.02f, 0.02f), "Stump", new Color(0.9f, 0.82f, 0.6f));
    }

    private static void BuildStadium()
    {
        var center = new Vector3(0f, 0f, 10f);

        // Boundary rope.
        const int ropeSegments = 48;
        for (int i = 0; i < ropeSegments; i++)
        {
            Vector3 radial = Radial(i, ropeSegments);
            float width = 2f * Mathf.PI * 30f / ropeSegments * 1.05f;
            GameObject seg = Decor(PrimitiveType.Cube, "Rope", null, center + radial * 30f + Vector3.up * 0.06f, new Vector3(width, 0.12f, 0.12f), "Rope", Color.white);
            seg.transform.rotation = Quaternion.LookRotation(radial);
        }

        // Two tiers of stands with a randomly coloured crowd (fixed seed so every build looks the same).
        Color[] crowd =
        {
            new Color(0.15f, 0.35f, 0.8f), new Color(0.9f, 0.9f, 0.9f), new Color(0.9f, 0.55f, 0.1f),
            new Color(0.8f, 0.15f, 0.15f), new Color(0.95f, 0.8f, 0.2f), new Color(0.2f, 0.65f, 0.4f),
        };

        Random.InitState(7);
        const int standSegments = 40;
        for (int tier = 0; tier < 2; tier++)
        {
            float radius = 38f + 3f * tier;
            float height = 2f + 2.5f * tier;
            float width = 2f * Mathf.PI * radius / standSegments * 1.03f;

            for (int i = 0; i < standSegments; i++)
            {
                Vector3 radial = Radial(i, standSegments);
                int pick = Random.Range(0, crowd.Length);
                GameObject block = Decor(PrimitiveType.Cube, "Stand", null, center + radial * radius + Vector3.up * (height / 2f), new Vector3(width, height, 3f), "Crowd" + pick, crowd[pick]);
                block.transform.rotation = Quaternion.LookRotation(radial);
            }
        }

        // Floodlight towers.
        for (int i = 0; i < 4; i++)
        {
            Vector3 radial = Radial(i, 4) + Vector3.zero;
            radial = Quaternion.Euler(0f, 45f, 0f) * radial;
            Vector3 basePos = center + radial * 50f;
            Decor(PrimitiveType.Cylinder, "Tower", null, basePos + Vector3.up * 12f, new Vector3(0.6f, 12f, 0.6f), "Tower", new Color(0.55f, 0.55f, 0.6f));
            GameObject head = Decor(PrimitiveType.Cube, "Floodlight", null, basePos + Vector3.up * 24.5f, new Vector3(5f, 2.5f, 0.5f), "Floodlight", new Color(1f, 0.97f, 0.8f));
            head.transform.rotation = Quaternion.LookRotation(-radial);
        }
    }

    private static CoachSwing BuildCoach()
    {
        var root = new GameObject("Coach");
        root.transform.SetPositionAndRotation(new Vector3(0f, 0f, 18f), Quaternion.Euler(0f, 180f, 0f));

        Color shirt = new Color(0.12f, 0.3f, 0.75f);
        Color skin = new Color(0.78f, 0.58f, 0.42f);
        Color white = new Color(0.94f, 0.94f, 0.94f);

        Part(root.transform, PrimitiveType.Capsule, "Leg L", new Vector3(-0.12f, 0.45f, 0f), new Vector3(0.22f, 0.45f, 0.22f), "CoachWhite", white);
        Part(root.transform, PrimitiveType.Capsule, "Leg R", new Vector3(0.12f, 0.45f, 0f), new Vector3(0.22f, 0.45f, 0.22f), "CoachWhite", white);
        Part(root.transform, PrimitiveType.Capsule, "Torso", new Vector3(0f, 1.2f, 0f), new Vector3(0.45f, 0.4f, 0.28f), "CoachShirt", shirt);
        Part(root.transform, PrimitiveType.Sphere, "Head", new Vector3(0f, 1.75f, 0f), Vector3.one * 0.24f, "CoachSkin", skin);
        Part(root.transform, PrimitiveType.Sphere, "Cap", new Vector3(0f, 1.86f, 0f), new Vector3(0.26f, 0.14f, 0.26f), "CoachShirt", shirt);
        Part(root.transform, PrimitiveType.Cube, "Cap Brim", new Vector3(0f, 1.8f, 0.13f), new Vector3(0.2f, 0.02f, 0.14f), "CoachShirt", shirt);

        GameObject armL = Part(root.transform, PrimitiveType.Capsule, "Arm L", new Vector3(-0.3f, 1.25f, 0.05f), new Vector3(0.1f, 0.28f, 0.1f), "CoachShirt", shirt);
        armL.transform.localRotation = Quaternion.Euler(0f, 0f, -15f);
        GameObject armR = Part(root.transform, PrimitiveType.Capsule, "Arm R", new Vector3(0.3f, 1.25f, 0.05f), new Vector3(0.1f, 0.28f, 0.1f), "CoachShirt", shirt);
        armR.transform.localRotation = Quaternion.Euler(0f, 0f, 15f);

        // The bat swings around this pivot at hand height.
        var pivot = new GameObject("Bat Pivot").transform;
        pivot.SetParent(root.transform, false);
        pivot.localPosition = new Vector3(0.28f, 1.0f, 0.15f);

        GameObject handle = Part(pivot, PrimitiveType.Cylinder, "Bat Handle", new Vector3(0f, 0f, 0.12f), new Vector3(0.035f, 0.12f, 0.035f), "BatHandle", new Color(0.15f, 0.1f, 0.08f));
        handle.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
        Part(pivot, PrimitiveType.Cube, "Bat Blade", new Vector3(0f, 0f, 0.54f), new Vector3(0.11f, 0.04f, 0.6f), "BatWood", new Color(0.85f, 0.7f, 0.45f));

        CoachSwing swing = root.AddComponent<CoachSwing>();
        Set(swing, "batPivot", pivot);
        return swing;
    }

    private static ScoreUI BuildHud(out GameObject roundOverPanel)
    {
        // World-space canvases: a screen-space overlay is not drawn inside a VR headset.
        RectTransform hud = MakeCanvas("HUD", new Vector3(0f, 3.3f, 6f), new Vector2(1600f, 500f), 0.004f);
        MakePanel(hud, "Backdrop", new Vector2(0f, 90f), new Vector2(1200f, 230f), new Color(0f, 0f, 0f, 0.35f));
        Text scoreText = MakeText(hud, "Score", new Vector2(0f, 135f), 90, Color.white);
        Text ballsText = MakeText(hud, "Balls", new Vector2(0f, 50f), 52, new Color(0.85f, 0.9f, 1f));
        Text messageText = MakeText(hud, "Message", new Vector2(0f, -110f), 140, Color.white);

        RectTransform over = MakeCanvas("Round Over", new Vector3(0f, 1.9f, 3f), new Vector2(1200f, 600f), 0.003f);
        MakePanel(over, "Backdrop", Vector2.zero, new Vector2(1200f, 600f), new Color(0f, 0f, 0f, 0.8f));
        MakeText(over, "Title", new Vector2(0f, 200f), 90, new Color(0.85f, 0.9f, 1f)).text = "ROUND OVER";
        Text finalScoreText = MakeText(over, "Final Score", new Vector2(0f, 60f), 110, Color.white);
        Text ratingText = MakeText(over, "Rating", new Vector2(0f, -70f), 70, new Color(1f, 0.85f, 0.3f));
        MakeText(over, "Hint", new Vector2(0f, -200f), 48, new Color(0.5f, 1f, 0.6f)).text = "Touch the green ball to play again";

        ScoreUI ui = hud.gameObject.AddComponent<ScoreUI>();
        Set(ui, "scoreText", scoreText);
        Set(ui, "ballsText", ballsText);
        Set(ui, "messageText", messageText);
        Set(ui, "roundOverPanel", over.gameObject);
        Set(ui, "finalScoreText", finalScoreText);
        Set(ui, "ratingText", ratingText);

        roundOverPanel = over.gameObject;
        return ui;
    }

    private static void BuildGameplay(CoachSwing coach, ScoreUI ui)
    {
        var launcherObject = new GameObject("Ball Launcher");
        var release = new GameObject("Release Point").transform;
        release.SetParent(launcherObject.transform, false);
        release.position = new Vector3(0f, 1.3f, 16.5f);
        BallLauncher launcher = launcherObject.AddComponent<BallLauncher>();
        Set(launcher, "releasePoint", release);

        // PC test mode: a visible zone that follows the mouse.
        CatchZone mouseZone = CatchZone.Create("Mouse Catch Zone", 0.35f, true);
        mouseZone.transform.position = new Vector3(0f, 1.2f, 1f);
        mouseZone.GetComponent<Renderer>().sharedMaterial = MakeMaterial("CatchZone", new Color(1f, 0.9f, 0.2f, 0.35f), true);
        var debugCatcher = new GameObject("Debug Mouse Catcher").AddComponent<DebugMouseCatcher>();
        Set(debugCatcher, "catchZone", mouseZone.transform);

        // Quest: creates palm zones once an OVRHand exists in the scene. Does nothing on PC.
        new GameObject("Hand Catch Zones").AddComponent<HandCatchZones>();

        GameObject restart = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        restart.name = "Restart Target";
        restart.transform.position = new Vector3(0f, 1.1f, 1.4f);
        restart.transform.localScale = Vector3.one * 0.5f;
        restart.GetComponent<Renderer>().sharedMaterial = MakeMaterial("RestartTarget", new Color(0.3f, 1f, 0.45f, 0.6f), true);
        restart.GetComponent<Collider>().isTrigger = true;
        restart.AddComponent<RestartTarget>();
        restart.SetActive(false);

        var gameManager = new GameObject("Game Manager").AddComponent<GameManager>();
        Set(gameManager, "launcher", launcher);
        Set(gameManager, "coach", coach);
        Set(gameManager, "ui", ui);
        Set(gameManager, "restartTarget", restart);
    }

    // ---- helpers ----

    private static Vector3 Radial(int index, int count)
    {
        float angle = 2f * Mathf.PI * index / count;
        return new Vector3(Mathf.Sin(angle), 0f, Mathf.Cos(angle));
    }

    private static GameObject Primitive(PrimitiveType type, string name, Transform parent, Vector3 position, Vector3 scale, string materialName, Color color)
    {
        GameObject go = GameObject.CreatePrimitive(type);
        go.name = name;
        go.transform.SetParent(parent, false);
        go.transform.position = position;
        go.transform.localScale = scale;
        go.GetComponent<Renderer>().sharedMaterial = MakeMaterial(materialName, color);
        return go;
    }

    // Scenery: no collider, flagged for static batching.
    private static GameObject Decor(PrimitiveType type, string name, Transform parent, Vector3 position, Vector3 scale, string materialName, Color color)
    {
        GameObject go = Primitive(type, name, parent, position, scale, materialName, color);
        UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
        GameObjectUtility.SetStaticEditorFlags(go, StaticEditorFlags.BatchingStatic);
        return go;
    }

    // Character part: positioned in the parent's local space, no collider.
    private static GameObject Part(Transform parent, PrimitiveType type, string name, Vector3 localPosition, Vector3 localScale, string materialName, Color color)
    {
        GameObject go = GameObject.CreatePrimitive(type);
        go.name = name;
        go.transform.SetParent(parent, false);
        go.transform.localPosition = localPosition;
        go.transform.localScale = localScale;
        go.GetComponent<Renderer>().sharedMaterial = MakeMaterial(materialName, color);
        UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
        return go;
    }

    private static Material MakeMaterial(string name, Color color, bool transparent = false)
    {
        string path = MaterialsFolder + "/" + name + ".mat";
        Material material = AssetDatabase.LoadAssetAtPath<Material>(path);

        if (material == null)
        {
            Shader shader = transparent ? Shader.Find("Sprites/Default") : Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) shader = Shader.Find("Standard");
            material = new Material(shader);
            AssetDatabase.CreateAsset(material, path);
        }

        if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
        if (material.HasProperty("_Color")) material.SetColor("_Color", color);
        EditorUtility.SetDirty(material);
        return material;
    }

    private static RectTransform MakeCanvas(string name, Vector3 position, Vector2 size, float scale)
    {
        var go = new GameObject(name, typeof(Canvas));
        go.GetComponent<Canvas>().renderMode = RenderMode.WorldSpace;
        var rect = go.GetComponent<RectTransform>();
        rect.sizeDelta = size;
        rect.position = position;
        rect.localScale = Vector3.one * scale;
        return rect;
    }

    private static void MakePanel(RectTransform parent, string name, Vector2 position, Vector2 size, Color color)
    {
        var go = new GameObject(name, typeof(RectTransform), typeof(Image));
        go.transform.SetParent(parent, false);
        var rect = (RectTransform)go.transform;
        rect.anchoredPosition = position;
        rect.sizeDelta = size;
        go.GetComponent<Image>().color = color;
    }

    private static Text MakeText(RectTransform parent, string name, Vector2 position, int fontSize, Color color)
    {
        var go = new GameObject(name, typeof(RectTransform), typeof(Text), typeof(Outline));
        go.transform.SetParent(parent, false);
        var rect = (RectTransform)go.transform;
        rect.anchoredPosition = position;
        rect.sizeDelta = new Vector2(1500f, fontSize * 1.4f);

        Text text = go.GetComponent<Text>();
        text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        text.fontSize = fontSize;
        text.fontStyle = FontStyle.Bold;
        text.alignment = TextAnchor.MiddleCenter;
        text.color = color;
        text.horizontalOverflow = HorizontalWrapMode.Overflow;
        return text;
    }

    private static void Set(UnityEngine.Object target, string property, UnityEngine.Object value)
    {
        var serialized = new SerializedObject(target);
        serialized.FindProperty(property).objectReferenceValue = value;
        serialized.ApplyModifiedPropertiesWithoutUndo();
    }
}
