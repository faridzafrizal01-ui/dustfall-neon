// Round and match stats: every shot, hit, headshot, kill, grenade and round
// outcome, kept in one place and turned into the one-line summaries the
// round-end overlay shows. Nothing here touches the simulation; main.js pushes
// events in and reads the summary lines out. All numbers are integers except
// accuracy, which is a whole percent.
//
// Accuracy counts shots that hit a Raider over shots fired. A shot swallowed
// by a smoke cloud is neither a hit nor a miss — it is counted separately as
// blocked, because the cloud did its job. Damage is the hit points actually
// dealt to Raiders. Money is tracked per round so the overlay can show what
// the round cost and what it paid.
export function createStats() {
  // Per-round counters, reset on roundStart.
  let rShots = 0;
  let rHits = 0;
  let rHead = 0;
  let rBlocked = 0;
  let rDamage = 0;
  let rKills = 0;
  let rThrows = 0;
  let rSmoke = 0;
  let rSpent = 0;
  let rRound = 1;

  // Match totals, kept across rounds.
  let mShots = 0;
  let mHits = 0;
  let mHead = 0;
  let mBlocked = 0;
  let mDamage = 0;
  let mKills = 0;
  let mThrows = 0;
  let mSmoke = 0;
  let mSpent = 0;
  let mEarned = 0;
  let mRounds = 0;
  let mWins = 0;
  let mLosses = 0;
  let mDeaths = 0;

  // Best-round records, with the round they happened in.
  let bestKills = 0;
  let bestKillsRound = 0;
  let bestAcc = 0;
  let bestAccRound = 0;
  let bestDamage = 0;
  let bestDamageRound = 0;

  // The last ten round outcomes, newest first, for the match line.
  const history = [];

  function pct(hits, shots) {
    if (shots <= 0) return 0;
    return Math.round((hits / shots) * 100);
  }

  function roundAcc() {
    return pct(rHits, rShots);
  }

  function matchAcc() {
    return pct(mHits, mShots);
  }

  function streak() {
    // Current win/loss run, e.g. 'W2' or 'L1', from the newest history first.
    if (history.length === 0) return '';
    const first = history[0];
    let n = 0;
    for (const h of history) {
      if (h === first) n += 1;
      else break;
    }
    return `${first}${n}`;
  }

  return {
    // ---- events main.js pushes in ----
    shotFired() {
      rShots += 1;
      mShots += 1;
    },
    shotHit(head, damage) {
      rHits += 1;
      mHits += 1;
      rDamage += damage;
      mDamage += damage;
      if (head) {
        rHead += 1;
        mHead += 1;
      }
    },
    shotBlocked() {
      rBlocked += 1;
      mBlocked += 1;
    },
    kill() {
      rKills += 1;
      mKills += 1;
    },
    death() {
      mDeaths += 1;
    },
    thrown(kind) {
      if (kind === 'smoke') {
        rSmoke += 1;
        mSmoke += 1;
      } else {
        rThrows += 1;
        mThrows += 1;
      }
    },
    spent(amount) {
      rSpent += amount;
      mSpent += amount;
    },

    // ---- round lifecycle ----
    roundStart(round) {
      rShots = 0;
      rHits = 0;
      rHead = 0;
      rBlocked = 0;
      rDamage = 0;
      rKills = 0;
      rThrows = 0;
      rSmoke = 0;
      rSpent = 0;
      rRound = round;
    },
    roundEnd(win, earned) {
      mRounds += 1;
      mEarned += earned;
      if (win) mWins += 1;
      else mLosses += 1;
      history.unshift(win ? 'W' : 'L');
      if (history.length > 10) history.pop();
      // Best-round records only count rounds with at least one shot.
      if (rKills > bestKills) {
        bestKills = rKills;
        bestKillsRound = rRound;
      }
      const acc = roundAcc();
      if (rShots >= 5 && acc > bestAcc) {
        bestAcc = acc;
        bestAccRound = rRound;
      }
      if (rDamage > bestDamage) {
        bestDamage = rDamage;
        bestDamageRound = rRound;
      }
    },

    // ---- summaries the overlay reads ----
    roundLine() {
      const parts = [
        `Shots ${rShots}`,
        `Hits ${rHits} (${roundAcc()}%)`,
      ];
      if (rHead > 0) parts.push(`Headshots ${rHead}`);
      if (rBlocked > 0) parts.push(`Smoked ${rBlocked}`);
      parts.push(`Kills ${rKills}`);
      parts.push(`Damage ${rDamage}`);
      if (rThrows > 0) parts.push(`HE ×${rThrows}`);
      if (rSmoke > 0) parts.push(`Smoke ×${rSmoke}`);
      if (rSpent > 0) parts.push(`Spent $${rSpent}`);
      return parts.join('  ·  ');
    },
    matchLine() {
      const parts = [
        `Match ${mWins}W–${mLosses}L`,
        `Kills ${mKills}`,
        `Acc ${matchAcc()}%`,
      ];
      if (mHead > 0) parts.push(`Headshots ${mHead}`);
      if (mBlocked > 0) parts.push(`Smoked ${mBlocked}`);
      if (mDamage > 0) parts.push(`Damage ${mDamage}`);
      if (mDeaths > 0) parts.push(`Deaths ${mDeaths}`);
      if (mSpent > 0) parts.push(`Spent $${mSpent}`);
      if (mEarned > 0) parts.push(`Earned $${mEarned}`);
      const st = streak();
      if (st) parts.push(`Run ${st}`);
      return parts.join('  ·  ');
    },
    bestLine() {
      const parts = [];
      if (bestKills > 0) parts.push(`Best kills ${bestKills} (round ${bestKillsRound})`);
      if (bestAcc > 0) parts.push(`Best acc ${bestAcc}% (round ${bestAccRound})`);
      if (bestDamage > 0) parts.push(`Best damage ${bestDamage} (round ${bestDamageRound})`);
      return parts.join('  ·  ');
    },
    historyLine() {
      if (history.length === 0) return '';
      return `Last ${history.length}: ${history.join(' ')}`;
    },

    // ---- raw numbers, for anything that needs them ----
    round() {
      return {
        round: rRound,
        shots: rShots,
        hits: rHits,
        headshots: rHead,
        blocked: rBlocked,
        damage: rDamage,
        kills: rKills,
        accuracy: roundAcc(),
        throws: rThrows,
        smokes: rSmoke,
        spent: rSpent,
      };
    },
    match() {
      return {
        rounds: mRounds,
        wins: mWins,
        losses: mLosses,
        shots: mShots,
        hits: mHits,
        headshots: mHead,
        blocked: mBlocked,
        damage: mDamage,
        kills: mKills,
        deaths: mDeaths,
        accuracy: matchAcc(),
        throws: mThrows,
        smokes: mSmoke,
        spent: mSpent,
        earned: mEarned,
        bestKills,
        bestKillsRound,
        bestAcc,
        bestAccRound,
        bestDamage,
        bestDamageRound,
      };
    },
  };
}
