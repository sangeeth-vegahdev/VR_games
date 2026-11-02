using UnityEngine;

// A trigger sphere that catches the ball. Used for both the PC mouse zone and the hand palm zones.
public class CatchZone : MonoBehaviour
{
    public static CatchZone Create(string zoneName, float radius, bool visible)
    {
        GameObject go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        go.name = zoneName;
        go.transform.localScale = Vector3.one * radius * 2f;
        go.GetComponent<SphereCollider>().isTrigger = true;

        if (!visible) Destroy(go.GetComponent<MeshRenderer>());

        Rigidbody body = go.AddComponent<Rigidbody>();
        body.isKinematic = true;
        body.useGravity = false;

        return go.AddComponent<CatchZone>();
    }

    private void OnTriggerEnter(Collider other)
    {
        Ball ball = other.GetComponent<Ball>();
        if (ball != null) ball.Catch();
    }
}
