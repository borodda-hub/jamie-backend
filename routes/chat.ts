import express from 'express';
import { getJamieResponse, scoreDQ } from '../utils/openai';
import { jamieSystemPrompt } from '../utils/prompts';

const router = express.Router();

type DQDimension = 'framing' | 'alternatives' | 'information' | 'values' | 'reasoning' | 'commitment';

// In-memory session state storage (For Production, replace with Redis/DB)
const sessionState: Record<string, {
  turnsUsed: number;
  dqCoverage: Record<DQDimension, boolean>;
  dqCumulativeScore: Record<DQDimension, number>;
}> = {};

const MAX_TURNS = 12;
const COVERAGE_THRESHOLD = 0.6;  // Cumulative score needed to count a DQ dimension as "covered"

router.post('/', async (req, res) => {
  const userMessage: string = req.body.message;
  const sessionId: string = req.body.session_id || 'anon-session';
  const userId: string = req.body.user_id || 'anon-user';

  if (!sessionState[sessionId]) {
    sessionState[sessionId] = {
      turnsUsed: 0,
      dqCoverage: {
        framing: false,
        alternatives: false,
        information: false,
        values: false,
        reasoning: false,
        commitment: false
      },
      dqCumulativeScore: {
        framing: 0,
        alternatives: 0,
        information: 0,
        values: 0,
        reasoning: 0,
        commitment: 0
      }
    };
  }

  sessionState[sessionId].turnsUsed += 1;

  try {
    console.log("Received message:", userMessage);

    const jamieReply = await getJamieResponse(userMessage, jamieSystemPrompt);
    console.log("Jamie reply:", jamieReply);

    const dqScore = await scoreDQ(userMessage);
    console.log("DQ Score:", dqScore);

    // Update cumulative scores and coverage
    for (const dimension of Object.keys(dqScore) as DQDimension[]) {
      const currentScore = dqScore[dimension].score;
      sessionState[sessionId].dqCumulativeScore[dimension] += currentScore;
      console.log(`Cumulative ${dimension}:`, sessionState[sessionId].dqCumulativeScore[dimension]);

      if (sessionState[sessionId].dqCumulativeScore[dimension] >= COVERAGE_THRESHOLD) {
        sessionState[sessionId].dqCoverage[dimension] = true;
      }
    }

    const turnsUsed = sessionState[sessionId].turnsUsed;
    const turnsRemaining = MAX_TURNS - turnsUsed;
    const dqCoverage = sessionState[sessionId].dqCoverage;

    let conversationStatus = 'in-progress';
    if (Object.values(dqCoverage).every(Boolean)) {
      conversationStatus = 'dq-complete';
    } else if (turnsRemaining <= 0) {
      conversationStatus = 'turn-limit-reached';
    }

    const sessionSummary = (conversationStatus !== 'in-progress') ? {
      totalTurns: turnsUsed,
      dqAreasCompleted: Object.keys(dqCoverage).filter((k) => dqCoverage[k as DQDimension]),
      dqAreasMissed: Object.keys(dqCoverage).filter((k) => !dqCoverage[k as DQDimension]),
      feedback: conversationStatus === 'dq-complete' ? 'You covered all key areas of Decision Quality.' : 'Session ended before all DQ areas were explored.'
    } : null;

    const response = {
      session_id: sessionId,
      user_id: userId,
      user_message: userMessage,
      jamie_reply: jamieReply,
      dq_score: dqScore,
      turnsUsed,
      turnsRemaining,
      dqCoverage,
      conversationStatus,
      sessionSummary,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);

  } catch (err) {
    console.error("Error processing chat:", err);
    res.status(500).send('Failed to process message.');
  }
});

module.exports = router;
