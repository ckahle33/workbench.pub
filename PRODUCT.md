# Product

<!-- impeccable:product-schema 1 -->

> Source note: written by the assistant from facts the owner confirmed in the design conversation (docs/superpowers/specs/2026-11-07-workbench-design.md) and the owner's own earlier notes on "Workprint" (~/src/ideas/2026-10-27-ideas.md). Not re-interviewed; the owner may correct it.

## Platform

web

## Users

Makers who build things over time and want to show how: electronics and guitar-pedal builders, music producers and recordists, ceramicists, woodworkers, illustrators, 3D printers. Visitors can read without an account; posting needs an existing Bluesky/AT Protocol account.

## Product Purpose

workbench.pub is a social site for showing a project as it gets made. The unit of content is a project: a titled thing with a timeline of updates (photos, notes, links, parts lists). People follow projects and topics and reply to individual updates. Success: a maker posts a project with several updates and other people follow and reply to it. First goal, in the owner's words: show it to about ten makers, and aim for five of them posting a project timeline.

## Positioning

Photo sites show the finished thing; this one makes the process the main event, a visible, dated timeline. Posts live in each author's own AT Protocol account (records under `pub.workbench.*`), so people own their work and sign in with an existing identity. A neighboring product that stores user content itself could not truthfully claim that.

## Terminology

- project: the thing being made; update: a dated step in a project's timeline; reply: a comment on an update; topic: a subject area (electronics, ceramics...) anyone can create and follow. The word "circle" is not used.

## Constraints

- Runs on the Cloudflare free tier (Worker + D1 + static assets): keep pages light, images are served from authors' own PDS via a proxy.
- Content is user-written plain text; never render it as HTML.
- Accessibility: keyboard operable, labelled controls, alt text required on every image, sufficient contrast, 44px touch targets.
- The owner's visual direction is a pinned brief: the "Workprint Screens" Swiss/International-style mockups (see the design brief for the restyle).

## Voice

Plain, direct, specific. No marketing language, no exclamation marks, no emoji.
