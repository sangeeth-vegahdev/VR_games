using UnityEngine;

public class BallLauncher : MonoBehaviour
{
    [SerializeField] private Transform releasePoint;
    [SerializeField] private Vector3 target = new Vector3(0f, 1.2f, 0.5f);
    [SerializeField] private float targetSpread = 0.5f;

    [Header("Speed (m/s)")]
    [SerializeField] private float startSpeed = 12f;
    [SerializeField] private float speedIncreasePerBall = 1.5f;
    [SerializeField] private float maxSpeed = 22f;

    [Header("Swing (sideways acceleration, m/s^2)")]
    [SerializeField] private float swingAcceleration = 1f;
    [SerializeField] private float swingIncreasePerBall = 0.25f;

    [SerializeField] private float missZ = 0f;
    [SerializeField] private float ballRadius = 0.08f;

    private Ball current;

    public float LastSpeedKmh { get; private set; }

    public void Launch(int ballNumber)
    {
        DestroyBall();

        int step = ballNumber - 1;
        float speed = Mathf.Min(startSpeed + speedIncreasePerBall * step, maxSpeed);
        float swing = swingAcceleration + swingIncreasePerBall * step;
        LastSpeedKmh = speed * 3.6f;

        Vector3 start = releasePoint.position;
        Vector3 aim = target + new Vector3(Random.Range(-targetSpread, targetSpread), Random.Range(-0.2f, 0.2f), 0f);
        Vector3 swingDirection = Vector3.right * (Random.value < 0.5f ? -1f : 1f);

        current = CreateBall();
        current.transform.position = start;
        current.Init((aim - start).normalized * speed, swingDirection, swing, missZ);
    }

    public void DestroyBall()
    {
        if (current != null) Destroy(current.gameObject);
        current = null;
    }

    private Ball CreateBall()
    {
        GameObject go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        go.name = "Cricket Ball";
        go.transform.localScale = Vector3.one * ballRadius * 2f;
        go.GetComponent<Renderer>().material.color = new Color(0.7f, 0.05f, 0.05f);
        go.AddComponent<Rigidbody>();

        Material trailMaterial = FeedbackFx.SpriteMaterial();
        if (trailMaterial != null)
        {
            TrailRenderer trail = go.AddComponent<TrailRenderer>();
            trail.material = trailMaterial;
            trail.time = 0.3f;
            trail.startWidth = ballRadius * 1.8f;
            trail.endWidth = 0f;
            trail.startColor = new Color(1f, 0.45f, 0.3f, 0.8f);
            trail.endColor = new Color(1f, 0.45f, 0.3f, 0f);
        }

        return go.AddComponent<Ball>();
    }
}
