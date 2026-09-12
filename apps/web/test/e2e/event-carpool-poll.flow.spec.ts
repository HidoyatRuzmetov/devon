// @flow -- H30.1 flow 5/6: an event with a carpool and a poll -- create, RSVP, a *different* member
// claiming a carpool seat (the driver cannot claim their own offer -- `EventConflictError
// ('driver_cannot_claim_own_offer')`, correctly, so this flow seeds a second member for that step
// rather than working around real business logic), vote -- the real `/api/v1/events/*` contract
// chain, with the real `/events` list rendering the result.
import { expect, test } from '@playwright/test'
import {
  authedPost,
  createApprovedDepartment,
  examplePassword,
  joinDepartmentAsNewUser,
  loginAsSuperAdmin,
  newFlowContext,
  uniqueLogin,
} from './flow-api.js'

test('@flow event with a carpool and a poll: create, RSVP, claim a seat, vote', async ({ browser }) => {
  const superAdminContext = await newFlowContext(browser)
  await loginAsSuperAdmin(superAdminContext)

  const headContext = await newFlowContext(browser)
  const headPage = await headContext.newPage()
  const head = { login: uniqueLogin('flow.ehead'), password: examplePassword() }
  const { joinKey, joinPassword } = await createApprovedDepartment(headContext, superAdminContext, {
    headLogin: head.login,
    headPassword: head.password,
    departmentName: `Event flow ${head.login.slice(-8)}`,
  })
  await superAdminContext.close()

  const memberContext = await newFlowContext(browser)
  const member = { login: uniqueLogin('flow.emember'), password: examplePassword() }
  await joinDepartmentAsNewUser(memberContext, {
    login: member.login,
    password: member.password,
    joinKey,
    joinPassword,
  })

  const eventTitle = `Flow event ${Date.now()}`
  const startsAt = new Date(Date.now() + 86_400_000).toISOString()
  const endsAt = new Date(Date.now() + 90_000_000).toISOString()
  const eventRes = await authedPost(headContext, '/api/v1/events', {
    title: eventTitle,
    startsAt,
    endsAt,
    capacity: 5,
  })
  expect(eventRes.status()).toBe(201)
  const event = (await eventRes.json()) as { id: string }

  // Real UI: the event shows up on the real `/events` list.
  await headPage.goto('/events')
  await expect(headPage.getByText(eventTitle)).toBeVisible()

  // RSVP -- both the head (driver-to-be) and the member (rider-to-be).
  const rsvpRes = await authedPost(headContext, `/api/v1/events/${event.id}/rsvp`, {
    status: 'yes',
    guests: 0,
  })
  expect(rsvpRes.status()).toBe(200)
  const memberRsvpRes = await authedPost(memberContext, `/api/v1/events/${event.id}/rsvp`, {
    status: 'yes',
    guests: 0,
  })
  expect(memberRsvpRes.status()).toBe(200)

  // A poll, with two options, voted on.
  const pollRes = await authedPost(headContext, `/api/v1/events/${event.id}/polls`, {
    kind: 'single',
    question: 'Flow: qachon uchrashamiz?',
    options: [{ label: 'Dushanba' }, { label: 'Seshanba' }],
  })
  expect(pollRes.status()).toBe(201)
  const poll = (await pollRes.json()) as { id: string; options: { id: string }[] }

  const voteRes = await authedPost(headContext, `/api/v1/events/${event.id}/polls/${poll.id}/vote`, {
    optionIds: [poll.options[0]!.id],
  })
  expect(voteRes.status()).toBe(200)

  // The head offers a carpool; the member (not the driver) claims a seat in it.
  const carpoolRes = await authedPost(headContext, `/api/v1/events/${event.id}/carpools`, {
    seats: 3,
  })
  expect(carpoolRes.status()).toBe(201)
  const carpool = (await carpoolRes.json()) as { id: string }

  const claimRes = await authedPost(
    memberContext,
    `/api/v1/events/${event.id}/carpools/${carpool.id}/claim`,
    { seats: 1 },
  )
  expect(claimRes.status()).toBe(204)

  // Authoritative re-check: the poll, re-fetched, carries the vote tally.
  const pollsAfter = await headContext.request.get(`/api/v1/events/${event.id}/polls`)
  const { items: pollsAfterItems } = (await pollsAfter.json()) as {
    items: { id: string; totalVotes: number; options: { id: string; votes: number }[] }[]
  }
  const votedPoll = pollsAfterItems.find((p) => p.id === poll.id)!
  expect(votedPoll.totalVotes).toBe(1)
  expect(votedPoll.options.find((o) => o.id === poll.options[0]!.id)?.votes).toBe(1)

  await headContext.close()
  await memberContext.close()
})
