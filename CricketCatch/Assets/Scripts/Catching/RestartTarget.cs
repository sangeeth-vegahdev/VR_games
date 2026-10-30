using UnityEngine;

// Touch this with a palm (or the mouse zone on PC) after the round ends to play again.
// A world-space target works with hand tracking, where a screen button does not.
public class RestartTarget : MonoBehaviour
{
    private void OnTriggerStay(Collider other)
    {
        if (GameManager.Instance.CanRestart && other.GetComponent<CatchZone>() != null)
        {
            GameManager.Instance.RestartRound();
        }
    }
}
