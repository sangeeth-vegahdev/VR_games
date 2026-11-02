using UnityEngine;

public enum GameState { Ready, Throwing, Caught, Missed, RoundOver }

public class GameManager : MonoBehaviour
{
    public static GameManager Instance { get; private set; }

    [SerializeField] private BallLauncher launcher;
    [SerializeField] private CoachSwing coach;
    [SerializeField] private ScoreUI ui;
    [SerializeField] private GameObject restartTarget;
    [SerializeField] private int ballsPerRound = 6;
    [SerializeField] private float readyDelay = 1f;
    [SerializeField] private float feedbackDelay = 1.2f;
    [SerializeField] private float restartLockout = 1f;

    public GameState State { get; private set; }
    public int Score { get; private set; }
    public int Misses { get; private set; }
    public int BallNumber { get; private set; }

    // Hands (or the mouse) must touch the restart target, but only after a short lockout
    // so a hand that is already in the way cannot restart the round by accident.
    public bool CanRestart => State == GameState.RoundOver && Time.time - roundOverAt > restartLockout;

    private float timer;
    private float roundOverAt;

    private void Awake()
    {
        Instance = this;
    }

    private void Start()
    {
        RestartRound();
    }

    private void Update()
    {
        switch (State)
        {
            case GameState.Ready:
                timer -= Time.deltaTime;
                if (timer <= 0f) ThrowNextBall();
                break;

            case GameState.Caught:
            case GameState.Missed:
                timer -= Time.deltaTime;
                if (timer <= 0f) AdvanceAfterFeedback();
                break;

            case GameState.RoundOver:
                if (CanRestart && (Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.R))) RestartRound();
                break;
        }
    }

    public void RestartRound()
    {
        launcher.DestroyBall();
        Score = 0;
        Misses = 0;
        BallNumber = 0;
        State = GameState.Ready;
        timer = readyDelay;

        restartTarget.SetActive(false);
        ui.SetScore(Score, Misses);
        ui.SetBalls(BallNumber, ballsPerRound, 0f);
        ui.ShowMessage("Get ready");
        ui.HideRoundOver();
    }

    public void OnBallCaught(Vector3 position)
    {
        if (State != GameState.Throwing) return;
        Score++;
        FeedbackFx.Caught(position);
        Resolve(GameState.Caught, "CAUGHT!", new Color(0.4f, 1f, 0.5f));
    }

    public void OnBallMissed(Vector3 position)
    {
        if (State != GameState.Throwing) return;
        Misses++;
        FeedbackFx.Missed(position);
        Resolve(GameState.Missed, "MISSED", new Color(1f, 0.4f, 0.35f));
    }

    private void ThrowNextBall()
    {
        BallNumber++;
        State = GameState.Throwing;

        coach.PlayShot();
        launcher.Launch(BallNumber);

        ui.SetBalls(BallNumber, ballsPerRound, launcher.LastSpeedKmh);
        ui.ShowMessage("");
    }

    private void Resolve(GameState next, string message, Color color)
    {
        State = next;
        timer = feedbackDelay;

        ui.SetScore(Score, Misses);
        ui.ShowMessage(message, color);
    }

    private void AdvanceAfterFeedback()
    {
        if (BallNumber >= ballsPerRound)
        {
            State = GameState.RoundOver;
            roundOverAt = Time.time;
            restartTarget.SetActive(true);
            ui.ShowRoundOver(Score, ballsPerRound);
            return;
        }

        State = GameState.Ready;
        timer = readyDelay;
        ui.ShowMessage("Get ready");
    }
}
