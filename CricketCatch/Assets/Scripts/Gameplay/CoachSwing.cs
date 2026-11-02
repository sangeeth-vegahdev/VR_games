using System.Collections;
using UnityEngine;

public class CoachSwing : MonoBehaviour
{
    [SerializeField] private Transform batPivot;
    [SerializeField] private float readyAngle = 60f;
    [SerializeField] private float followThroughAngle = -120f;
    [SerializeField] private float swingDuration = 0.35f;
    [SerializeField] private float returnDuration = 0.5f;

    private Coroutine swinging;

    private void Start()
    {
        batPivot.localRotation = Quaternion.Euler(0f, readyAngle, 0f);
    }

    public void PlayShot()
    {
        if (swinging != null) StopCoroutine(swinging);
        swinging = StartCoroutine(Swing());
    }

    private IEnumerator Swing()
    {
        yield return Rotate(readyAngle, followThroughAngle, swingDuration);
        yield return Rotate(followThroughAngle, readyAngle, returnDuration);
    }

    private IEnumerator Rotate(float from, float to, float duration)
    {
        float time = 0f;
        while (time < duration)
        {
            time += Time.deltaTime;
            float t = Mathf.SmoothStep(0f, 1f, time / duration);
            batPivot.localRotation = Quaternion.Euler(0f, Mathf.Lerp(from, to, t), 0f);
            yield return null;
        }
    }
}
