using UnityEngine;

[RequireComponent(typeof(Rigidbody))]
public class Ball : MonoBehaviour
{
    [SerializeField] private float maxLifetime = 4f;

    private Rigidbody body;
    private Vector3 swingDirection;
    private float swingAcceleration;
    private float missZ;
    private float age;
    private bool resolved;

    private void Awake()
    {
        body = GetComponent<Rigidbody>();
        body.useGravity = false;
        body.collisionDetectionMode = CollisionDetectionMode.ContinuousDynamic;
    }

    public void Init(Vector3 velocity, Vector3 swingDirection, float swingAcceleration, float missZ)
    {
        body.linearVelocity = velocity;
        this.swingDirection = swingDirection;
        this.swingAcceleration = swingAcceleration;
        this.missZ = missZ;
    }

    private void FixedUpdate()
    {
        if (!resolved) body.AddForce(swingDirection * swingAcceleration, ForceMode.Acceleration);
    }

    private void Update()
    {
        if (resolved) return;

        age += Time.deltaTime;
        if (transform.position.z < missZ || age > maxLifetime) Miss();
    }

    // The resolved flag guarantees a ball can only ever score or miss once.
    public void Catch()
    {
        if (resolved) return;
        resolved = true;
        Freeze();
        GameManager.Instance.OnBallCaught(transform.position);
    }

    private void Miss()
    {
        resolved = true;
        Freeze();
        GameManager.Instance.OnBallMissed(transform.position);
    }

    private void Freeze()
    {
        body.linearVelocity = Vector3.zero;
        body.isKinematic = true;
    }
}
