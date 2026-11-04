import { useEffect, useRef, useState } from 'react';
import {
  assertLesson,
  scoreActivity,
  textFor,
  type Activity,
  type Lesson,
  type LessonEvent,
  type ContentBlock,
} from '@lessonbooks/contracts';
import { ui } from '../i18n';
import './player.css';

export type PlayerProps = {
  lesson: Lesson;
  revision?: number;
  onEvent?: (event: LessonEvent) => void;
  assets?: Record<string, string>;
};
export function Player({ lesson, revision = 1, onEvent, assets = {} }: PlayerProps) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<unknown>({});
  const [feedback, setFeedback] = useState<'correct' | 'incorrect' | 'hint' | null>(null);
  const [checked, setChecked] = useState(false);
  const [completed, setCompleted] = useState(false);
  const scores = useRef<Record<string, number>>({});
  const started = useRef(Date.now());
  const mounted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const items = lesson.sections.flatMap((section) =>
    section.activities.map((activity) => ({ section, activity })),
  );
  const current = items[index];
  const t = ui(lesson.metadata.language);
  const text = (value: Parameters<typeof textFor>[0]) => textFor(value, lesson.metadata.language);
  const emit = (type: LessonEvent['type'], details: Partial<LessonEvent> = {}) =>
    onEvent?.({
      event_id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
      schema_version: '1.0.0',
      lesson_id: lesson.id,
      lesson_revision: revision,
      type,
      timestamp: new Date().toISOString(),
      ...details,
    });
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      emit('started');
    }
  }, []); // A player instance is keyed by lesson/revision by its host.
  useEffect(() => {
    if (index > 0) heading.current?.focus();
  }, [index]);
  try {
    assertLesson(lesson);
  } catch {
    return <div role="alert">{t.notReady}</div>;
  }
  if (!current) return <div role="alert">{t.notReady}</div>;
  const total = Object.values(scores.current).reduce((a, b) => a + b, 0);
  const max = items.reduce((sum, item) => sum + item.activity.points, 0);
  const activity = current.activity;
  function check() {
    const result = scoreActivity(activity, answer);
    scores.current[activity.id] = result.score;
    setChecked(true);
    setFeedback(result.correct ? 'correct' : 'incorrect');
    emit('answered', { activity_id: activity.id, score: result.score, max_score: result.maxScore });
  }
  function advance() {
    if (index === items.length - 1) {
      setCompleted(true);
      const score = Object.values(scores.current).reduce((a, b) => a + b, 0);
      emit('score', { score, max_score: max });
      emit('completed', {
        score,
        max_score: max,
        duration_ms: Math.min(Date.now() - started.current, 86400000),
      });
    } else {
      setIndex(index + 1);
      setAnswer({});
      setFeedback(null);
      setChecked(false);
    }
  }
  return (
    <main className="lesson-player" dir={lesson.metadata.direction} lang={lesson.metadata.language}>
      <header className="lesson-header">
        <span className="eyebrow">{t.preview}</span>
        <h1>{text(lesson.metadata.title)}</h1>
        <p>{t.noProgress}</p>
        <progress
          aria-label={text(lesson.metadata.title)}
          value={completed ? items.length : index}
          max={items.length}
        />
      </header>
      {completed ? (
        <section className="activity-card complete" aria-live="polite">
          <span aria-hidden="true" className="sun">
            ✦
          </span>
          <h2>{t.complete}</h2>
          <p>
            {t.points}: <strong>{total}</strong> {t.scoreOf} {max}
          </p>
        </section>
      ) : (
        <>
          <section className="content-card" aria-label={text(current.section.title)}>
            <h2>{text(current.section.title)}</h2>
            {current.section.blocks.map((block, i) => (
              <Block key={i} block={block} language={lesson.metadata.language} assets={assets} />
            ))}
          </section>
          <section className="activity-card">
            <span className="step">
              {index + 1} / {items.length}
            </span>
            <h2 tabIndex={-1} ref={heading} id="activity-prompt">
              {text(activity.prompt)}
            </h2>
            <ActivityInput
              key={activity.id}
              activity={activity}
              language={lesson.metadata.language}
              answer={answer}
              onChange={(value) => {
                setAnswer(value);
                setChecked(false);
                setFeedback(null);
              }}
            />
            <div className="activity-actions">
              <button className="primary" onClick={check}>
                {t.check}
              </button>
              <button
                onClick={() => {
                  setFeedback('hint');
                  emit('hint_used', { activity_id: activity.id });
                }}
              >
                {t.hint}
              </button>
            </div>
            <div className={`feedback ${feedback ?? ''}`} role="status" aria-live="polite">
              {feedback && text(activity.feedback[feedback])}
            </div>
            {checked && (
              <button className="next" onClick={advance}>
                {index === items.length - 1 ? t.finish : t.next} <span aria-hidden="true">→</span>
              </button>
            )}
          </section>
        </>
      )}
    </main>
  );
}
function Block({
  block,
  language,
  assets,
}: {
  block: ContentBlock;
  language: string;
  assets: Record<string, string>;
}) {
  const text = (value: Parameters<typeof textFor>[0]) => textFor(value, language);
  if (block.type === 'image') {
    const source = assets[block.media.asset_id];
    return source && /^(blob:|data:image\/(png|jpeg|webp);base64,)/.test(source) ? (
      <img src={source} alt={text(block.media.alt)} />
    ) : (
      <p>{text(block.media.alt)}</p>
    );
  }
  if (block.type === 'vocabulary')
    return (
      <dl>
        <dt>{text(block.term)}</dt>
        <dd>{text(block.definition)}</dd>
      </dl>
    );
  return (
    <p className={block.type === 'tip' ? 'tip' : ''}>
      {text(block.text)}
      {block.type === 'read_aloud' && (
        <button
          onClick={() => {
            // Only installed local voices: never send lesson text to a remote speech service.
            const voice = speechSynthesis
              .getVoices()
              .find((v) => v.localService && v.lang.startsWith(language.split('-')[0]!));
            if (voice) {
              const speech = new SpeechSynthesisUtterance(text(block.text));
              speech.voice = voice;
              speech.lang = language;
              speechSynthesis.speak(speech);
            }
          }}
        >
          {ui(language).read}
        </button>
      )}
    </p>
  );
}
function ActivityInput({
  activity,
  language,
  answer,
  onChange,
}: {
  activity: Activity;
  language: string;
  answer: unknown;
  onChange: (value: unknown) => void;
}) {
  const t = ui(language);
  const text = (value: Parameters<typeof textFor>[0]) => textFor(value, language);
  const map =
    answer && typeof answer === 'object' && !Array.isArray(answer)
      ? (answer as Record<string, string>)
      : {};
  if (activity.type === 'multiple_choice') {
    const selected = Array.isArray(answer) ? (answer as string[]) : [];
    return (
      <fieldset aria-labelledby="activity-prompt">
        <legend>{activity.content.multiple ? t.selectAll : t.selectOne}</legend>
        <div className="options">
          {activity.content.options.map((option) => (
            <label
              className={`option ${selected.includes(option.id) ? 'selected' : ''}`}
              key={option.id}
            >
              <input
                type={activity.content.multiple ? 'checkbox' : 'radio'}
                name={activity.id}
                checked={selected.includes(option.id)}
                onChange={() =>
                  onChange(
                    activity.content.multiple
                      ? selected.includes(option.id)
                        ? selected.filter((id) => id !== option.id)
                        : [...selected, option.id]
                      : [option.id],
                  )
                }
              />
              <span>{text(option.text)}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (activity.type === 'true_false')
    return (
      <fieldset aria-labelledby="activity-prompt">
        <legend>{text(activity.content.statement)}</legend>
        <div className="options">
          {[true, false].map((value) => (
            <label className={`option ${answer === value ? 'selected' : ''}`} key={String(value)}>
              <input
                type="radio"
                name={activity.id}
                checked={answer === value}
                onChange={() => onChange(value)}
              />
              <span>{value ? t.true : t.false}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  if (activity.type === 'fill_in_the_blank')
    return (
      <div className="blank-inputs">
        {activity.content.blanks.map((blank) => (
          <label key={blank.id}>
            {text(blank.label)}
            <input
              autoComplete="off"
              value={map[blank.id] ?? ''}
              onChange={(event) => onChange({ ...map, [blank.id]: event.target.value })}
            />
          </label>
        ))}
      </div>
    );
  if (activity.type === 'drag_to_match' || activity.type === 'categorize') {
    const sources =
      activity.type === 'drag_to_match' ? activity.content.left : activity.content.items;
    const choices =
      activity.type === 'drag_to_match' ? activity.content.right : activity.content.categories;
    return (
      <div>
        <p className="input-help">{t.keyboardHelp}</p>
        <div className="match-list">
          {sources.map((item) => (
            <label key={item.id} className="match-row">
              <span>{text(item.text)}</span>
              <select
                value={map[item.id] ?? ''}
                onChange={(event) => onChange({ ...map, [item.id]: event.target.value })}
              >
                <option value="">{t.choose}</option>
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {text(choice.text)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>
    );
  }
  return <p role="alert">{t.notReady}</p>;
}
