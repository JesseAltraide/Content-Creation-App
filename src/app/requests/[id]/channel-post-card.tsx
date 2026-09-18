"use client";

import { useState } from "react";
import { asList } from "@/lib/eval-shape";
import CopyTextButton from "@/components/copy-text-button";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScoreBar } from "@/components/ui/score-bar";
import { parseXPosts, parseNewsletter, CHANNEL_LABELS, floorForPass2Criterion } from "@/lib/channel-post-format";
import EditChannelPostForm from "./edit-channel-post-form";
import ReviseWithSuggestionsButton from "./revise-with-suggestions-button";
import ImageSuggestion, { type StoredImageSuggestion } from "./image-suggestion";
import ChannelVersionPicker, { type ChannelVersion } from "./channel-version-picker";

type EvalResult = {
  overall_score: number;
  criteria: { name: string; score: number; max: number; notes?: string }[];
  weakest_criteria_suggestions: string[] | null;
  hard_block_triggered: boolean;
  hard_block_reason: string | null;
};

function LinkedInPreview({ body }: { body: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{body}</p>
        <CopyTextButton text={body} label="Copy post" />
      </div>
    </div>
  );
}

function XPreview({ body }: { body: string }) {
  const posts = parseXPosts(body);
  // A thread is posted one box at a time, so per-post copy is the one that matches how
  // the work is actually done. The whole-thread copy uses the same separator the edit
  // box expects, so it round-trips: copy it out, change it elsewhere, paste it back.
  const wholeThread = posts.join(`${"\n\n"}---${"\n\n"}`);

  return (
    <div className="flex flex-col gap-2">
      {posts.length > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted">
            {posts.length} posts. Copy them one at a time to post the thread.
          </span>
          <CopyTextButton text={wholeThread} label="Copy whole thread" variant="outline" />
        </div>
      )}
      {posts.map((post, i) => (
        <div key={i} className="rounded-lg border border-border bg-background p-4 text-sm leading-relaxed text-foreground">
          <div className="flex items-center justify-between gap-3">
            {posts.length > 1 ? (
              <p className="text-xs font-semibold text-muted">
                Post {i + 1} of {posts.length}
              </p>
            ) : (
              <span />
            )}
            <CopyTextButton text={post} label={posts.length > 1 ? `Copy post ${i + 1}` : "Copy post"} />
          </div>
          <p className="mt-1.5 whitespace-pre-wrap">{post}</p>
          <p className="mt-2 text-xs text-muted">{post.length}/280 characters</p>
        </div>
      ))}
    </div>
  );
}

function NewsletterPreview({ body }: { body: string }) {
  const { subject_line, body_markdown } = parseNewsletter(body);
  // Subject and body separately, because they go into two different fields wherever
  // this ends up being sent from.
  return (
    <div className="rounded-lg border border-border bg-background p-4 text-sm leading-relaxed text-foreground">
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-border pb-2">
        <p className="min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Subject </span>
          {subject_line}
        </p>
        <CopyTextButton text={subject_line} label="Copy subject" />
      </div>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 whitespace-pre-wrap">{body_markdown}</p>
        <CopyTextButton text={body_markdown} label="Copy body" />
      </div>
    </div>
  );
}

function ChannelPreview({ channel, body }: { channel: string; body: string }) {
  if (channel === "x") return <XPreview body={body} />;
  if (channel === "newsletter") return <NewsletterPreview body={body} />;
  return <LinkedInPreview body={body} />;
}


export default function ChannelPostCard({
  requestId,
  channel,
  body,
  evaluation,
  isOwner,
  imageSuggestion,
  versions,
}: {
  requestId: string;
  channel: "linkedin" | "x" | "newsletter";
  body: string;
  /** Null until someone asks. Newsletter never has one: it is sent as plain text. */
  imageSuggestion?: StoredImageSuggestion;
  evaluation: EvalResult | undefined;
  /** Reviewers see the post and its scores, never the controls. */
  isOwner: boolean;
  /** Every version this channel has, so the author can pick which one to work with. */
  versions: ChannelVersion[];
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingEdit, setConfirmingEdit] = useState(false);
  const suggestions = asList<string>(evaluation?.weakest_criteria_suggestions);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{CHANNEL_LABELS[channel] ?? channel}</h3>
        <div className="flex items-center gap-3">
          {evaluation && <span className="text-lg font-bold">{evaluation.overall_score}/100</span>}
          {isOwner && !editing && (
            <Button variant="ghost" onClick={() => setConfirmingEdit(true)}>
              Edit
            </Button>
          )}
        </div>
      </div>

      {confirmingEdit && !editing && (
        <div className="mt-3 rounded-lg border border-accent/20 bg-accent-soft p-3">
          <p className="text-sm font-medium text-accent">Your edit is kept exactly as you write it.</p>
          <p className="mt-1 text-xs text-accent/90">
            This works differently from &ldquo;Apply these suggestions&rdquo;. That one discards a
            rewrite that scores lower and keeps your existing post. A manual edit is yours: it is
            saved as written and re-scored afterwards, and it is never reverted for scoring less
            than an earlier version. If the new score is lower, the queue will say so before you
            schedule, and the choice stays with you.
          </p>
          <p className="mt-1.5 text-xs text-accent/90">
            Small wording or punctuation fixes may be treated as grammatical and keep the existing
            score rather than triggering a fresh evaluation. Anything touching numbers, claims or
            whole sentences is always re-scored.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              onClick={() => {
                setEditing(true);
                setConfirmingEdit(false);
              }}
            >
              Start editing
            </Button>
            <Button variant="ghost" onClick={() => setConfirmingEdit(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3">
        {editing ? (
          // Two columns while editing: the suggestions are the whole reason for the
          // edit, and they used to sit below the evaluation, far enough down that
          // acting on them meant scrolling away from the text being changed.
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <EditChannelPostForm
              requestId={requestId}
              channel={channel}
              currentBody={body}
              onCancel={() => setEditing(false)}
            />
            {suggestions.length > 0 && (
              <aside className="lg:sticky lg:top-6 lg:self-start">
                <div className="rounded-lg bg-warning-soft p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-warning">
                    Improvement suggestions
                  </p>
                  <ul className="mt-1.5 flex list-disc flex-col gap-2 pl-4 text-xs leading-relaxed text-warning">
                    {suggestions.map((sug, i) => (
                      <li key={i}>{sug}</li>
                    ))}
                  </ul>
                </div>
              </aside>
            )}
          </div>
        ) : (
          <ChannelPreview channel={channel} body={body} />
        )}
      </div>

      {evaluation && (
        <div className="mt-4 border-t border-border pt-4">
          {evaluation.hard_block_triggered && (
            <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              Hard block: {evaluation.hard_block_reason ?? "a critical criterion fell below its floor."}
            </p>
          )}
          <div className="flex flex-col gap-3">
            {asList<{ name: string; score: number; max: number; notes?: string }>(evaluation.criteria).map((c) => (
              <div key={c.name}>
                <ScoreBar label={c.name} score={c.score} max={c.max} floor={floorForPass2Criterion(c.name)} />
                {c.notes && <p className="mt-1 text-xs text-muted">{c.notes}</p>}
              </div>
            ))}
          </div>
          {evaluation.weakest_criteria_suggestions && evaluation.weakest_criteria_suggestions.length > 0 && (
            <div className="mt-3 rounded-lg bg-warning-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-warning">
                Improvement suggestions
              </p>
              <ul className="mt-1.5 flex flex-col gap-1 text-sm text-warning">
                {asList(evaluation.weakest_criteria_suggestions).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              {isOwner && !editing && <ReviseWithSuggestionsButton requestId={requestId} channel={channel} />}
            </div>
          )}
        </div>
      )}

      {!editing && (
        <ChannelVersionPicker
          requestId={requestId}
          channel={channel}
          versions={versions}
          isOwner={isOwner}
        />
      )}

      {channel !== "newsletter" && !editing && (
        <ImageSuggestion
          requestId={requestId}
          channel={channel}
          suggestion={imageSuggestion ?? null}
          isOwner={isOwner}
        />
      )}

    </Card>
  );
}
