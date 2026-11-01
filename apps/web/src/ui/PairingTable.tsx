import type { ReactNode } from 'react';
import { PlayerName } from './PlayerName';
import { Piece, Result } from './primitives';
import { nameParts } from './names';
import { formatPoints, resultSpoken, type ResultCode } from './results';

export type PairingPlayer = {
  name: string;
  /** Score before this round. */
  points?: number | null;
  /** From `formatDisambiguator`, only for players `findLookalikes` flagged. */
  disambiguator?: string | null;
};

export type PairingBoard = {
  board: number;
  white: PairingPlayer | null;
  black: PairingPlayer | null;
  result: ResultCode | null;
  /** The round is confirmed: the result turns from pen to ink. */
  confirmed?: boolean;
  /** Not yet delivered to the cloud: hollow marker. */
  unsent?: boolean;
  /** Who entered it, for the "By" column. */
  by?: string | null;
  /** Needs a person: red bar. Pair it with text in the "Needs you" rail. */
  flagged?: boolean;
};

export type PairingSection = {
  /** Omit the name for an event with one section. */
  name?: string;
  note?: ReactNode;
  boards: PairingBoard[];
};

export type PairingTableProps = {
  /** Read by screen readers: "Round 4 pairings". */
  caption: string;
  sections: PairingSection[];
  /** The board under the keyboard cursor. */
  cursorBoard?: number | null;
  /** Replaces the result cell on a board, for desk entry buttons. */
  renderResult?: (board: PairingBoard) => ReactNode;
  /** Off for parents and print headers that don't care who entered a result. */
  showBy?: boolean;
  onBoardClick?: (board: PairingBoard) => void;
};

function spokenRow(b: PairingBoard): string {
  const side = (p: PairingPlayer | null, colour: string) =>
    p ? `${colour}, ${nameParts(p.name).display}, ${formatPoints(p.points ?? 0)} points` : `${colour}, no player`;
  return `Board ${b.board}. ${side(b.white, 'White')}. ${resultSpoken(b.result)}. ${side(b.black, 'Black')}.`;
}

function Side({ player, color }: { player: PairingPlayer | null; color: 'white' | 'black' }) {
  if (!player) return <span className="ui-pt__empty">No player</span>;
  return (
    <span className="ui-pt__player">
      <Piece color={color} />
      <PlayerName name={player.name} disambiguator={player.disambiguator} />
    </span>
  );
}

/**
 * The canonical pairing sheet: Bd | Pts | White | Result | Black | Pts | By. White always left, Black
 * always right, result dead centre. Sections sit inside one table, so no board can hide behind a tab.
 * Below 640 px of its own width each board stacks, using a container query rather than the viewport.
 */
export function PairingTable({
  caption,
  sections,
  cursorBoard,
  renderResult,
  showBy = true,
  onBoardClick,
}: PairingTableProps) {
  const columns = showBy ? 7 : 6;
  return (
    <div className="ui-pt-wrap">
      <table className={`ui-pt${showBy ? '' : ' ui-pt--no-by'}`}>
        <caption className="ui-vh">
          {caption}. Each row is one board: board number, White with points, result, Black with points.
        </caption>
        <colgroup>
          <col className="ui-pt__c-bd" />
          <col className="ui-pt__c-pts" />
          <col />
          <col className="ui-pt__c-res" />
          <col />
          <col className="ui-pt__c-pts" />
          {showBy && <col className="ui-pt__c-by" />}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="ui-pt__h ui-pt__h--num">
              Bd
            </th>
            <th scope="col" className="ui-pt__h ui-pt__h--num">
              Pts
            </th>
            <th scope="col" className="ui-pt__h">
              White
            </th>
            <th scope="col" className="ui-pt__h ui-pt__h--mid">
              Result
            </th>
            <th scope="col" className="ui-pt__h">
              Black
            </th>
            <th scope="col" className="ui-pt__h ui-pt__h--num">
              Pts
            </th>
            {showBy && (
              <th scope="col" className="ui-pt__h ui-pt__h--num">
                By
              </th>
            )}
          </tr>
        </thead>
        {sections.map((section, i) => (
          <tbody key={section.name ?? i}>
            {section.name && (
              <tr className="ui-pt__section">
                <th scope="rowgroup" colSpan={columns}>
                  {section.name}
                  {section.note ? <span className="ui-pt__note"> {section.note}</span> : null}
                </th>
              </tr>
            )}
            {section.boards.map((b) => (
              <tr
                key={b.board}
                className={[
                  'ui-pt__row',
                  b.board === cursorBoard && 'is-cursor',
                  b.flagged && 'is-flagged',
                  onBoardClick && 'is-clickable',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-current={b.board === cursorBoard ? 'true' : undefined}
                onClick={onBoardClick ? () => onBoardClick(b) : undefined}
              >
                <th scope="row" className="ui-pt__bd" aria-label={spokenRow(b)}>
                  {b.board}
                </th>
                <td className="ui-pt__pts ui-pt__pts--w">
                  <span className="ui-vh">White points </span>
                  {formatPoints(b.white?.points)}
                </td>
                <td className="ui-pt__w">
                  <Side player={b.white} color="white" />
                </td>
                <td className="ui-pt__res">
                  {renderResult ? (
                    renderResult(b)
                  ) : (
                    <Result result={b.result} confirmed={b.confirmed} unsent={b.unsent} />
                  )}
                </td>
                <td className="ui-pt__b">
                  <Side player={b.black} color="black" />
                </td>
                <td className="ui-pt__pts ui-pt__pts--b">
                  <span className="ui-vh">Black points </span>
                  {formatPoints(b.black?.points)}
                </td>
                {showBy && <td className="ui-pt__by">{b.by}</td>}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
