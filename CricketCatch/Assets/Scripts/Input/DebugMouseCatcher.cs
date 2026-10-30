using UnityEngine;

// PC test mode: the mouse moves a catch zone in front of the player. Disabled on Quest.
public class DebugMouseCatcher : MonoBehaviour
{
    [SerializeField] private Transform catchZone;
    [SerializeField] private float planeZ = 1f;

    private Camera cam;

    private void Awake()
    {
        if (Application.platform == RuntimePlatform.Android) enabled = false;
    }

    private void Start()
    {
        cam = Camera.main;
    }

    private void Update()
    {
        if (cam == null) return;

        Ray ray = cam.ScreenPointToRay(Input.mousePosition);
        var plane = new Plane(Vector3.forward, new Vector3(0f, 0f, planeZ));
        if (plane.Raycast(ray, out float distance))
        {
            Vector3 point = ray.GetPoint(distance);
            catchZone.position = new Vector3(point.x, point.y, planeZ);
        }
    }
}
