// The typing surface: one hidden input + a passage rendered as three memoized chunks
// (typed / current word / untyped), so a keystroke only re-renders the current word.

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import {
  PROGRESS_INTERVAL_MS,
  createTypingState,
  displayValue,
  isFinished,
  reconcileInput,
} from '@shared/index.js';
import { sound } from '../lib/sound.js';
import { useRoom } from '../state/RoomContext.jsx';
import styles from './TypingArea.module.css';

const Chunk = memo(function Chunk({ text, className }) {
  return <span className={className}>{text}</span>;
});

const CurrentWord = memo(
  forwardRef(function CurrentWord({ word, offset, wrong }, ref) {
    const done = word.slice(0, offset);
    const at = word[offset] ?? '';
    const rest = word.slice(offset + 1);
    return (
      <span ref={ref} className={styles.current}>
        <span className={styles.typed}>{done}</span>
        {at && (
          <span className={`${styles.cursor} ${wrong ? styles.wrong : ''}`}>{at === ' ' ? ' ' : at}</span>
        )}
        <span className={styles.pending}>{rest}</span>
      </span>
    );
  }),
);

function wordBounds(text, index) {
  const start = index === 0 ? 0 : text.lastIndexOf(' ', index - 1) + 1;
  const nextSpace = text.indexOf(' ', index);
  const end = nextSpace === -1 ? text.length : nextSpace + 1; // include trailing space
  return [start, end];
}

const TypingArea = forwardRef(function TypingArea({ passage, seed, active, waiting }, ref) {
  const text = passage.text;
  const { sendProgress, raceRef } = useRoom();
  const inputRef = useRef(null);
  const viewportRef = useRef(null);
  const scrollerRef = useRef(null);
  const currentRef = useRef(null);
  const [typing, setTyping] = useState(() =>
    createTypingState(seed ? { index: seed.correctIndex, keystrokes: seed.keystrokes, errors: seed.errorCount } : {}),
  );
  const typingRef = useRef(typing);
  const lastSentRef = useRef('');
  const [focused, setFocused] = useState(false);
  const [bump, setBump] = useState(0);

  const finished = isFinished(typing, text);
  const stalled = typing.wrong !== null;

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus({ preventScroll: true }) }), []);

  const flush = useCallback(() => {
    const s = typingRef.current;
    const key = `${s.index}|${s.errors}|${s.keystrokes}|${s.wrong !== null}`;
    if (key === lastSentRef.current) return;
    lastSentRef.current = key;
    sendProgress({ correctIndex: s.index, errorCount: s.errors, keystrokes: s.keystrokes, stalled: s.wrong !== null });
  }, [sendProgress]);

  // Mark the seed as already sent so a restored race does not resend it.
  useEffect(() => {
    const s = typingRef.current;
    lastSentRef.current = `${s.index}|${s.errors}|${s.keystrokes}|false`;
  }, []);

  useEffect(() => {
    if (!active || finished) return undefined;
    const id = setInterval(flush, PROGRESS_INTERVAL_MS);
    return () => {
      clearInterval(id);
      flush();
    };
  }, [active, finished, flush]);

  // Focus as soon as typing matters (countdown included, so mobile keyboards are up at GO).
  useEffect(() => {
    if (!finished) inputRef.current?.focus({ preventScroll: true });
  }, [active, finished]);

  // Keep the hidden input mirroring the engine state.
  useLayoutEffect(() => {
    if (inputRef.current) inputRef.current.value = displayValue(typing, text);
  }, [typing, text]);

  // Let the canvas react to a local stall instantly, without waiting for the server echo.
  useEffect(() => {
    raceRef.current.local = { stalled, index: typing.index, length: text.length };
  }, [stalled, typing.index, text.length, raceRef]);

  // Restart the "nudge" animation on each error/blocked key without re-rendering the passage.
  useEffect(() => {
    const el = viewportRef.current;
    if (!bump || !el) return;
    el.classList.remove(styles.nudge);
    void el.offsetWidth;
    el.classList.add(styles.nudge);
  }, [bump]);

  const [wordStart, wordEnd] = wordBounds(text, Math.min(typing.index, text.length));

  // Scroll so the current line stays as the first or second visible line.
  useLayoutEffect(() => {
    const el = currentRef.current;
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;
    const lineHeight = parseFloat(getComputedStyle(scroller).lineHeight) || 36;
    const shift = Math.max(0, el.offsetTop - lineHeight);
    scroller.style.transform = `translateY(${-shift}px)`;
  }, [wordStart]);

  function handleInput(e) {
    const value = e.currentTarget.value;
    if (!active || finished) {
      e.currentTarget.value = displayValue(typingRef.current, text);
      return;
    }
    const { state, events } = reconcileInput(typingRef.current, text, value);
    typingRef.current = state;
    setTyping(state);
    e.currentTarget.value = displayValue(state, text);
    if (events.includes('error')) sound.stall();
    if (events.includes('blocked') || events.includes('error')) setBump((b) => b + 1);
    if (events.includes('finished')) flush();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === 'Tab') e.preventDefault();
    // Caret must stay at the end; arrow keys and Home would desync the diff.
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) e.preventDefault();
  }

  let hint = null;
  if (finished) hint = 'Finished! Waiting for the others...';
  else if (waiting) hint = 'Get ready. Start typing at GO.';
  else if (!focused) hint = 'Tap here to keep typing';
  else if (stalled) hint = 'Stalled! Press backspace to fix it';

  return (
    <section
      className={`${styles.wrap} ${stalled ? styles.isStalled : ''} ${finished ? styles.isFinished : ''}`}
      onPointerUp={() => inputRef.current?.focus({ preventScroll: true })}
    >
      <div className={styles.viewport} ref={viewportRef}>
        <p className={styles.passage} aria-hidden="true">
          <span ref={scrollerRef} className={styles.scroller}>
            <Chunk text={text.slice(0, wordStart)} className={styles.typed} />
            <CurrentWord ref={currentRef} word={text.slice(wordStart, wordEnd)} offset={typing.index - wordStart} wrong={stalled} />
            <Chunk text={text.slice(wordEnd)} className={styles.untyped} />
          </span>
        </p>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          aria-label="Type the passage. A wrong key stalls your car until you press backspace."
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="next"
          inputMode="text"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>
      <p className={styles.hint} aria-live="polite">
        {hint ?? ' '}
      </p>
    </section>
  );
});

export default TypingArea;
