using UnityEngine;

// Free, asset-less feedback: tones are generated in code and the burst is a built-in particle system.
public static class FeedbackFx
{
    private static AudioClip caughtClip;
    private static AudioClip missedClip;

    public static void Caught(Vector3 position)
    {
        if (caughtClip == null) caughtClip = MakeTone("Caught", 660f, 990f, 0.25f);
        AudioSource.PlayClipAtPoint(caughtClip, position, 1f);
        Burst(position, new Color(0.4f, 1f, 0.5f));
    }

    public static void Missed(Vector3 position)
    {
        if (missedClip == null) missedClip = MakeTone("Missed", 220f, 110f, 0.35f);
        AudioSource.PlayClipAtPoint(missedClip, position, 1f);
    }

    public static Material SpriteMaterial()
    {
        Shader shader = Shader.Find("Sprites/Default");
        return shader != null ? new Material(shader) : null;
    }

    private static AudioClip MakeTone(string clipName, float startHz, float endHz, float seconds)
    {
        const int rate = 44100;
        int samples = (int)(rate * seconds);
        var data = new float[samples];
        float phase = 0f;

        for (int i = 0; i < samples; i++)
        {
            float t = (float)i / samples;
            phase += 2f * Mathf.PI * Mathf.Lerp(startHz, endHz, t) / rate;
            data[i] = Mathf.Sin(phase) * (1f - t) * 0.5f;
        }

        AudioClip clip = AudioClip.Create(clipName, samples, 1, rate, false);
        clip.SetData(data, 0);
        return clip;
    }

    private static void Burst(Vector3 position, Color color)
    {
        Material material = SpriteMaterial();
        if (material == null) return;

        // Configured while inactive: a particle system cannot change its duration once it is playing.
        var go = new GameObject("Catch Burst");
        go.SetActive(false);
        go.transform.position = position;

        var particles = go.AddComponent<ParticleSystem>();
        var main = particles.main;
        main.duration = 0.5f;
        main.loop = false;
        main.startLifetime = 0.6f;
        main.startSpeed = 2.5f;
        main.startSize = 0.06f;
        main.startColor = color;
        main.gravityModifier = 0.3f;
        main.stopAction = ParticleSystemStopAction.Destroy;

        var emission = particles.emission;
        emission.rateOverTime = 0f;
        emission.SetBursts(new[] { new ParticleSystem.Burst(0f, 40) });

        var shape = particles.shape;
        shape.shapeType = ParticleSystemShapeType.Sphere;
        shape.radius = 0.05f;

        go.GetComponent<ParticleSystemRenderer>().material = material;
        go.SetActive(true);
    }
}
