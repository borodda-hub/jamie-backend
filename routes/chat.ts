import express from 'express';
import { getJamieResponse, scoreDQ } from '../utils/openai';
import { jamieSystemPrompt } from '../utils/prompts';

const router = express.Router();

// In-memory session state storage (For Production, replace with Redis/DB)
const sessionState: Record<string, {
  turnsUsed: number;
  dqCoverage: {
    framing: boolean;
    alternatives: boolean;
    information: boolean;
    values: boolean;
    reasoning: boolean;
    commitment: boolean;
  };
}> = {};

const MAX_TURNS = 12;

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

    // Update DQ coverage if score >= 0.3
    for (const dimension of Object.keys(dqScore)) {
      if (dqScore[dimension] >= 0.3) {
        sessionState[sessionId].dqCoverage[dimension as keyof typeof dqScore] = true;
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
      dqAreasCompleted: Object.keys(dqCoverage).filter(k => dqCoverage[k as keyof typeof dqCoverage]),
      dqAreasMissed: Object.keys(dqCoverage).filter(k => !dqCoverage[k as keyof typeof dqCoverage]),
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
