using UnityEngine;

// Hand tracking input (Meta XR Core SDK). Kept apart from the game logic: it only creates
// palm-sized catch zones that follow each tracked OVRHand. Palm position and zone size are
// tuned on device. Finger poses are not used, since tracking is least reliable during fast motion.
public class HandCatchZones : MonoBehaviour
{
    [SerializeField] private float palmRadius = 0.15f;
    [SerializeField] private Vector3 palmOffset = new Vector3(0f, 0.03f, 0.05f);
    [SerializeField] private float trackingGrace = 0.2f;

    private OVRHand[] hands = new OVRHand[0];
    private Transform[] zones = new Transform[0];
    private float[] lastTracked = new float[0];
    private float searchTimer;

    private void Update()
    {
        if (hands.Length == 0)
        {
            searchTimer -= Time.deltaTime;
            if (searchTimer <= 0f)
            {
                searchTimer = 1f;
                FindHands();
            }
            return;
        }

        for (int i = 0; i < hands.Length; i++)
        {
            if (hands[i].IsTracked)
            {
                lastTracked[i] = Time.time;
                zones[i].position = hands[i].transform.TransformPoint(palmOffset);
            }

            // Keep the zone briefly after tracking drops so a momentary dropout does not cost a catch.
            zones[i].gameObject.SetActive(Time.time - lastTracked[i] < trackingGrace);
        }
    }

    private void FindHands()
    {
        hands = FindObjectsByType<OVRHand>(FindObjectsSortMode.None);
        zones = new Transform[hands.Length];
        lastTracked = new float[hands.Length];

        for (int i = 0; i < hands.Length; i++)
        {
            zones[i] = CatchZone.Create(hands[i].name + " Palm Zone", palmRadius, false).transform;
            lastTracked[i] = float.NegativeInfinity;
        }
    }
}
