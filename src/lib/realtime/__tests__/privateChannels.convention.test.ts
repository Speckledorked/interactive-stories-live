// src/lib/realtime/__tests__/privateChannels.convention.test.ts
//
// #491: both Pusher channels were PUBLIC, with no auth endpoint anywhere
// in the repository.
//
// A public Pusher channel is subscribable by anyone holding the app key,
// and the app key is NEXT_PUBLIC_ by necessity — it ships in the client
// bundle. So the only thing between a stranger and another player's feed
// was knowing an id, and ids are not secrets here: a campaign id is in the
// URL bar and in every shared invite link, and a user id is published to
// every member of a campaign inside message payloads. Whispers and
// notification previews travel in cleartext on `user-<id>`.
//
// What makes this stay fixed is not the rename. It is that twenty-five
// files built these names from their own template literals — publishers
// and subscribers, server and client — so "are we private yet" had
// twenty-five independent answers. This test enforces the single owner.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { campaignChannel, userChannel, campaignIdFromChannel, userIdFromChannel } from '../channels'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')
const SRC = join(REPO_ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      walk(full, out)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

describe('channel names', () => {
  it('are private, so Pusher demands a signed grant before subscribing', () => {
    // The prefix is not decoration: pusher-js refuses to subscribe to a
    // `private-` channel without a signature from the auth endpoint. The
    // prefix and that endpoint are two halves of one mechanism — either
    // alone does nothing.
    expect(campaignChannel('camp1')).toBe('private-campaign-camp1')
    expect(userChannel('user1')).toBe('private-user-user1')
  })

  it('round-trip back to the id the auth endpoint has to check', () => {
    expect(campaignIdFromChannel(campaignChannel('camp1'))).toBe('camp1')
    expect(userIdFromChannel(userChannel('user1'))).toBe('user1')
    // ...and each rejects the other's shape, so a campaign channel can
    // never be authorised by the "is this you" branch or vice versa.
    expect(userIdFromChannel(campaignChannel('camp1'))).toBeNull()
    expect(campaignIdFromChannel(userChannel('user1'))).toBeNull()
    expect(campaignIdFromChannel('campaign-camp1')).toBeNull()
  })
})

describe('the auth endpoint', () => {
  it('exists', () => {
    // Without it, every `private-` subscription fails and realtime is
    // simply dead — which is why the rename and the route must ship
    // together.
    expect(existsSync(join(SRC, 'app', 'api', 'pusher', 'auth', 'route.ts'))).toBe(true)
  })
})

describe('no file builds a channel name for itself', () => {
  it('has no raw `campaign-${...}` or `user-${...}` Pusher channel left', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      if (file.endsWith(join('realtime', 'channels.ts'))) continue
      const source = readFileSync(file, 'utf8')
      source.split('\n').forEach((line, i) => {
        if (!/`(?:campaign|user)-\$\{/.test(line)) return
        // Two legitimate non-channel uses of the same shape: a download
        // filename, and an OpenAI prompt_cache_key. Matched on what the
        // line does rather than excluded by path, so the exemption cannot
        // quietly cover a real channel added to the same file later.
        if (/link\.download|prompt_cache_key/.test(line)) return
        offenders.push(`${file.slice(REPO_ROOT.length + 1)}:${i + 1}`)
      })
    }
    expect(
      offenders,
      `Build channel names with campaignChannel()/userChannel() — a hand-written one ` +
        `silently drops the \`private-\` prefix and the authorisation that comes with it:\n  ` +
        offenders.join('\n  ')
    ).toEqual([])
  })
})
