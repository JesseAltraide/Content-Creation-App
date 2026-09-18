"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScoreBar } from "@/components/ui/score-bar";
import { parseXPosts, parseNewsletter, CHANNEL_LABELS, floorForPass2Criterion } from "@/lib/channel-post-format";
import EditChannelPostForm from "./edit-channel-post-form";
import GenerateAlternateToneButton from "./generate-alternate-tone-button";
import SelectToneVariantButton from "./select-tone-variant-button";

type EvalResult = {
  overall_score: number;
  criteria: { name: string; score: number; max: number; notes?: string }[];
  weakest_criteria_suggestions: string[] | null;
  hard_block_triggered: boolean;
  hard_block_reason: string | null;
};

function LinkedInPreview({ body }: { body: string }) {
  return (
    <div className="whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-sm leading-relaxed text-foreground">
      {body}
    </div>
  );
}

function XPreview({ body }: { body: string }) {
  const posts = parseXPosts(body);
  return (
    <div className="flex flex-col gap-2">
      {posts.map((post, i) => (
        <div key={i} className="rounded-lg border border-border bg-background p-4 text-sm leading-relaxed text-foreground">
          {posts.length > 1 && (
            <p className="mb-1.5 text-xs font-semibold text-muted">
              Post {i + 1} of {posts.length}
            </p>
          )}
          <p className="whitespace-pre-wrap">{post}</p>
          <p className="mt-2 text-xs text-muted">{post.length}/280 characters</p>
        </div>
      ))}
    </div>
  );
}

function NewsletterPreview({ body }: { body: string }) {
  const { subject_line, body_markdown } = parseNewsletter(body);
  return (
    <div className="rounded-lg border border-border bg-background p-4 text-sm leading-relaxed text-foreground">
      <p className="mb-2 border-b border-border pb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Subject </span>
        {subject_line}
      </p>
      <p className="whitespace-pre-wrap">{body_markdown}</p>
    </div>
  );
}

function ChannelPreview({ channel, body }: { channel: string; body: string }) {
  if (channel === "x") return <XPreview body={body} />;
  if (channel === "newsletter") return <NewsletterPreview body={body} />;
  return <LinkedInPreview body={body} />;
}

type AlternateVariant = {
  version: number;
  body: string;
  evaluation: EvalResult | undefined;
};

export default function ChannelPostCard({
  requestId,
  channel,
  body,
  evaluation,
  alternate,
  isOwner,
}: {
  requestId: string;
  channel: "linkedin" | "x" | "newsletter";
  body: string;
  evaluation: EvalResult | undefined;
  alternate?: AlternateVariant;
  /** Reviewers see the post and its scores, never the controls. */
  isOwner: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{CHANNEL_LABELS[channel] ?? channel}</h3>
        <div className="flex items-center gap-3">
          {evaluation && <span className="text-lg font-bold">{evaluation.overall_score}/100</span>}
          {isOwner && !editing && (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3">
        {editing ? (
          <EditChannelPostForm
            requestId={requestId}
            channel={channel}
            currentBody={body}
            onCancel={() => setEditing(false)}
          />
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
            {evaluation.criteria.map((c) => (
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
                {evaluation.weakest_criteria_suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {isOwner && !editing && (
        <div className="mt-4 border-t border-border pt-4">
          {alternate ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Alternate tone (pending)
              </p>
              <div className="mt-2">
                <ChannelPreview channel={channel} body={alternate.body} />
              </div>
              {alternate.evaluation && (
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-sm font-semibold">{alternate.evaluation.overall_score}/100</span>
                  {alternate.evaluation.hard_block_triggered && (
                    <span className="text-sm text-danger">
                      Hard block: {alternate.evaluation.hard_block_reason ?? "a critical criterion failed."}
                    </span>
                  )}
                </div>
              )}
              <div className="mt-3">
                <SelectToneVariantButton
                  requestId={requestId}
                  channel={channel}
                  version={alternate.version}
                  label="Use this instead"
                />
              </div>
            </div>
          ) : (
            <GenerateAlternateToneButton requestId={requestId} channel={channel} />
          )}
        </div>
      )}
    </Card>
  );
}
