const { sql } = require('./lib/db');

// A pick is correct if it exactly matches the graded answer - except number_guess questions,
// which are "correct" within +/-2 of the real number (e.g. "how many tendies get eaten"),
// not an exact match. A question's own `tolerance` overrides the 2 (the weekly longshot uses 5).
// The regex guards let malformed choice/correct_option values (shouldn't happen given write-time
// validation, but defensive) fall through to a normal string compare instead of erroring the whole
// query on a bad ::numeric cast.
const IS_NUMERIC_GUESS = `
  q.type = 'number_guess'
  AND p.choice ~ '^-?[0-9]+(\\.[0-9]+)?$'
  AND q.correct_option ~ '^-?[0-9]+(\\.[0-9]+)?$'
`;
const CORRECT_CASE = `
  CASE
    WHEN ${IS_NUMERIC_GUESS}
    THEN ABS(p.choice::numeric - q.correct_option::numeric) <= COALESCE(q.tolerance, 2)
    ELSE p.choice = q.correct_option
  END
`;

// A number_guess question with a `closest_bonus` also gives that many extra points to the closest
// guess (every guess tied for closest), separately from the tolerance: the closest guess gets the
// bonus even when it's outside the window. `closest` holds each such question's smallest miss; join it as c.
const CLOSEST_CTE = `
  closest AS (
    SELECT p.question_id, MIN(ABS(p.choice::numeric - q.correct_option::numeric)) AS diff
    FROM picks p
    JOIN questions q ON q.id = p.question_id
    WHERE q.closest_bonus IS NOT NULL AND ${IS_NUMERIC_GUESS}
    GROUP BY p.question_id
  )
`;
const POINTS = `
  CASE WHEN ${CORRECT_CASE} THEN q.points ELSE 0 END
  + CASE
      WHEN c.diff IS NOT NULL AND ${IS_NUMERIC_GUESS}
      THEN CASE WHEN ABS(p.choice::numeric - q.correct_option::numeric) = c.diff THEN q.closest_bonus ELSE 0 END
      ELSE 0
    END
`;

// Public: season-to-date leaderboard, plus each manager's points for the most recent graded week.
module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const season = (await sql.query(`
    WITH ${CLOSEST_CTE}
    SELECT p.manager,
      SUM(${POINTS}) AS points,
      COUNT(*) FILTER (WHERE q.correct_option IS NOT NULL) AS graded_picks
    FROM picks p
    JOIN questions q ON q.id = p.question_id
    LEFT JOIN closest c ON c.question_id = q.id
    GROUP BY p.manager
    ORDER BY points DESC
  `)).rows;

  const latestWeekRow = (await sql`
    SELECT MAX(week) AS week FROM questions WHERE correct_option IS NOT NULL
  `).rows[0];
  const latestWeek = latestWeekRow ? latestWeekRow.week : null;

  const thisWeek = latestWeek !== null
    ? (await sql.query(`
        WITH ${CLOSEST_CTE}
        SELECT p.manager,
          SUM(${POINTS}) AS points
        FROM picks p
        JOIN questions q ON q.id = p.question_id
        LEFT JOIN closest c ON c.question_id = q.id
        WHERE q.week = $1
        GROUP BY p.manager
      `, [latestWeek])).rows
    : [];

  res.status(200).json({ season, latest_week: latestWeek, this_week: thisWeek });
};
