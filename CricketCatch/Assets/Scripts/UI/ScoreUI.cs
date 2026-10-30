using UnityEngine;
using UnityEngine.UI;

public class ScoreUI : MonoBehaviour
{
    [SerializeField] private Text scoreText;
    [SerializeField] private Text ballsText;
    [SerializeField] private Text messageText;
    [SerializeField] private GameObject roundOverPanel;
    [SerializeField] private Text finalScoreText;
    [SerializeField] private Text ratingText;

    private void Awake()
    {
        roundOverPanel.SetActive(false);
    }

    public void SetScore(int score, int misses)
    {
        scoreText.text = $"Score {score}   |   Missed {misses}";
    }

    public void SetBalls(int thrown, int total, float speedKmh)
    {
        ballsText.text = thrown == 0 ? $"{total} balls per round" : $"Ball {thrown} / {total}   |   {speedKmh:0} km/h";
    }

    public void ShowMessage(string message)
    {
        ShowMessage(message, Color.white);
    }

    public void ShowMessage(string message, Color color)
    {
        messageText.text = message;
        messageText.color = color;
    }

    public void ShowRoundOver(int score, int total)
    {
        float ratio = (float)score / total;
        finalScoreText.text = $"Final score  {score} / {total}";
        ratingText.text = ratio >= 0.8f ? "Safe hands!" : ratio >= 0.5f ? "Good catching" : "Keep practising";
        roundOverPanel.SetActive(true);
    }

    public void HideRoundOver()
    {
        roundOverPanel.SetActive(false);
    }
}
