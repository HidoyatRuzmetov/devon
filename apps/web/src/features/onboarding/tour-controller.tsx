import * as React from 'react'
import { driver, type Driver } from 'driver.js'
import { useT } from '@devon/i18n'
import { Button } from '@devon/ui'
import { ConnectedSpotlight, visibleElement } from './connected-spotlight.js'
import { placeTourPopover } from './popover-placement.js'
import { TourFinale } from './tour-finale.js'
import { navigate, useRoutePath, useSearchParams } from '../../lib/router.js'
import { useOnboarding } from './context.js'
import { ProjectPractice } from './practice.js'
import { tourSteps } from './steps.js'
import 'driver.js/dist/driver.css'
import './onboarding.css'

export function TourController() {
  const t = useT()
  const { playing, setPlaying, step, setStep, query, mutation, replay } = useOnboarding()
  const path = useRoutePath()
  const search = useSearchParams()
  const searchCard = search.get('card')
  const routeQuery = search.toString()
  const { mutate } = mutation
  const [replayCardId, setReplayCardId] = React.useState<string | null>(null)
  const cardId = query.data?.run?.cardId ?? replayCardId
  const current = tourSteps[Math.min(step, tourSteps.length - 1)]!
  const engine = React.useRef<Driver | null>(null)
  const [spotlightTarget, setSpotlightTarget] = React.useState<HTMLElement | null>(null)
  const [ending, setEnding] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [waiting, setWaiting] = React.useState(false)
  const [targetRevision, refreshTarget] = React.useReducer((value: number) => value + 1, 0)
  const advance = React.useCallback(
    (next: number) => {
      const mobile = window.matchMedia('(max-width: 767px)').matches
      let destination = next
      while (mobile && tourSteps[destination]?.desktopOnly) destination += next < step ? -1 : 1
      setError(false)
      if (replay || !query.data?.run) {
        setStep(destination)
        return
      }
      mutate(
        { tourStep: destination, paused: false },
        {
          onSuccess: () => setStep(destination),
          onError: () => setError(true),
        },
      )
    },
    [replay, query.data?.run, mutate, setStep, step],
  )
  const pause = React.useCallback(() => {
    setPlaying(false)
    if (!replay && query.data?.run) mutate({ paused: true })
    navigate('/help')
  }, [setPlaying, replay, query.data?.run, mutate])
  const finish = React.useCallback(() => {
    const animate = () => {
      engine.current?.destroy()
      setEnding(true)
    }
    if (replay || !query.data?.run) animate()
    else
      mutate(
        { tourCompleted: true, paused: false },
        { onSuccess: animate, onError: () => setError(true) },
      )
  }, [replay, query.data?.run, mutate])

  React.useEffect(() => {
    if (playing && current.desktopOnly && window.matchMedia('(max-width: 767px)').matches)
      advance(step)
  }, [playing, step, current.desktopOnly, advance])

  React.useEffect(() => {
    if (!playing) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !current.practice && !ending && !event.repeat) {
        event.preventDefault()
        event.stopImmediatePropagation()
        document.querySelector<HTMLButtonElement>('.driver-popover-next-btn')?.click()
      }
      if (event.key === 'Escape' && !ending) {
        event.preventDefault()
        pause()
      }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [playing, pause, current.practice, ending])

  React.useEffect(() => {
    if (!playing || query.data?.required || ending) return
    const needsCard = current.key === 'drawer' || current.key === 'convert'
    const destination =
      current.path + (needsCard && cardId ? `?card=${encodeURIComponent(cardId)}` : '')
    if (window.location.pathname + window.location.search !== destination)
      navigate(destination, { replace: true })
  }, [playing, step, query.data?.required, ending, current, cardId])

  React.useEffect(() => {
    if (
      !playing ||
      query.data?.required ||
      ending ||
      current.practice ||
      (current.desktopOnly && window.matchMedia('(max-width: 767px)').matches) ||
      path !== current.path.split('?')[0] ||
      (current.path.includes('?') && `${path}?${routeQuery}` !== current.path)
    )
      return
    let cancelled = false
    let stopAction: (() => void) | undefined
    let stopPlacement: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let observer: MutationObserver | undefined
    let layoutFrame: number | undefined
    let settling = false
    const selector =
      current.target === 'onboarding-card'
        ? cardId
          ? `[data-onboarding-card-open="${cardId}"]`
          : '[data-onboarding-card-open]'
        : current.target
    const needsCard = current.key === 'drawer' || current.key === 'convert'
    if (needsCard && cardId && searchCard !== cardId) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const show = (target?: HTMLElement) => {
      if (cancelled) return
      observer?.disconnect()
      if (timer) clearTimeout(timer)
      setWaiting(false)
      setSpotlightTarget(target ?? null)
      if (target)
        target.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: 'instant',
        })
      if (current.nav)
        visibleElement(`[data-onboarding-nav="${current.nav}"]`)?.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: 'instant',
        })
      // Restore the expected demonstration state when replaying a chapter on a saved board.
      if (target && (current.key === 'collapse' || current.key === 'expand')) {
        const shouldBeCollapsed = current.key === 'expand'
        if ((target.dataset['collapsed'] === 'true') !== shouldBeCollapsed) target.click()
      }
      const actionStep = Boolean(current.action && target)
      const menuNavigation =
        current.nav &&
        !visibleElement(`[data-onboarding-nav="${current.nav}"]`) &&
        !current.nav.startsWith('/account') &&
        visibleElement('[data-onboarding-menu]')
      const bodyKey =
        !query.data?.run?.cardId && current.key === 'firstCard'
          ? 'onboarding.existingCardBody'
          : !query.data?.run?.cardId && current.key === 'drawer'
            ? 'onboarding.existingDrawerBody'
            : `onboarding.steps.${current.key}.body`
      const tour = driver({
        animate: !reduced,
        duration: 180,
        overlayOpacity: 0.48,
        stagePadding: 7,
        stageRadius: 10,
        allowKeyboardControl: false,
        allowClose: true,
        allowScroll: true,
        overlayClickBehavior: () => {},
        popoverClass: 'devon-onboarding-popover',
        onCloseClick: pause,
        onDestroyStarted: () => tour.destroy(),
      })
      engine.current = tour
      tour.highlight({
        ...(target ? { element: target } : {}),
        disableActiveInteraction: !actionStep,
        popover: {
          title: t(`onboarding.steps.${current.key}.title`),
          description:
            t(
              current.key === 'column' && window.matchMedia('(max-width: 767px)').matches
                ? 'onboarding.mobileColumns'
                : bodyKey,
            ) +
            (menuNavigation ? ` ${t('onboarding.mobileMenu')}` : '') +
            (!target && selector ? ` ${t('onboarding.targetMissing')}` : ''),
          side: current.key === 'finish' ? 'bottom' : 'left',
          align: 'start',
          showButtons: step === 0 ? ['next', 'close'] : ['previous', 'next', 'close'],
          nextBtnText: t(
            current.key === 'welcome'
              ? 'onboarding.beginWalkthrough'
              : current.key === 'finish'
                ? 'onboarding.finish'
                : actionStep
                  ? 'onboarding.showAction'
                  : 'onboarding.next',
          ),
          prevBtnText: t('onboarding.back'),
          onNextClick: () => {
            if (current.key === 'finish') finish()
            else if (actionStep && target) {
              target.focus()
              target.click()
            } else advance(step + 1)
          },
          onPrevClick: () => advance(Math.max(0, step - 1)),
          onCloseClick: pause,
          onPopoverRender: (popover) => {
            const welcome = current.key === 'welcome'
            if (welcome) popover.wrapper.classList.add('onboarding-welcome-popover')
            else {
              const page = document.createElement('span')
              page.className = 'onboarding-page-number'
              page.textContent = `${String(step).padStart(2, '0')} / ${tourSteps.length - 1}`
              page.setAttribute(
                'aria-label',
                t('onboarding.page', { current: step, total: tourSteps.length - 1 }),
              )
              popover.footer.prepend(page)
            }
            if (target)
              stopPlacement = placeTourPopover(popover.wrapper, target, current.nav, current.tab)
            requestAnimationFrame(() => {
              if (!cancelled) popover.nextButton.focus()
            })
            if (!welcome) {
              const progress = document.createElement('div')
              progress.className = 'onboarding-progress-track'
              progress.setAttribute('aria-hidden', 'true')
              const fill = document.createElement('span')
              fill.style.width = `${((step + 1) / tourSteps.length) * 100}%`
              progress.append(fill)
              popover.wrapper.append(progress)
            }
            popover.closeButton.setAttribute('aria-label', t('onboarding.pause'))
            popover.wrapper.setAttribute('role', 'dialog')
            popover.wrapper.setAttribute('aria-label', t(`onboarding.steps.${current.key}.title`))
          },
        },
      })
      if (current.key === 'orgChart') {
        // The chart is taller than some viewports. Keep its page heading and tabs
        // visible after Driver's automatic target scrolling, without moving the chart itself.
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
        document.getElementById('main')?.scrollTo({ top: 0, left: 0, behavior: 'instant' })
      }
      if (actionStep && target) {
        const clicked = () => {
          if (current.key === 'firstCard')
            setReplayCardId(target.dataset['onboardingCardOpen'] ?? null)
          if (!cancelled) advance(step + 1)
        }
        target.addEventListener('click', clicked, { once: true })
        stopAction = () => target.removeEventListener('click', clicked)
      }
      // A refreshed screen can replace its DOM after the guide has opened.
      // Reacquire the real control instead of measuring a detached, zero-size target.
      if (target) {
        observer = new MutationObserver(() => {
          if (!cancelled && !target.isConnected) {
            observer?.disconnect()
            refreshTarget()
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
      }
    }
    setWaiting(true)
    let profileOpened = false
    const find = () => {
      if (current.key === 'structure' || current.key === 'orgChart') {
        const view = current.key === 'orgChart' ? 'chart' : 'tree'
        const tab = visibleElement(`[data-onboarding-structure-tab="${view}"]`)
        if (tab && tab.getAttribute('data-state') !== 'active') {
          // Tabs activate on focus or pointer-down; click() alone does not select them.
          tab.focus({ preventScroll: true })
          tab.click()
          return undefined
        }
      }
      if (
        current.key === 'peopleProfile' &&
        !profileOpened &&
        !visibleElement('[data-onboarding="member-panel"]')
      ) {
        const member =
          visibleElement(
            '[data-onboarding="open-member-profile"][data-onboarding-profile-filled="true"]',
          ) ?? visibleElement('[data-onboarding="open-member-profile"]')
        if (member) {
          profileOpened = true
          member.click()
        }
      }
      const candidates = selector ? [...document.querySelectorAll<HTMLElement>(selector)] : []
      return candidates.find(
        (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
      )
    }
    const settle = (target: HTMLElement) => {
      if (settling) return
      settling = true
      const started = performance.now()
      let last = ''
      let stable = 0
      const tick = () => {
        if (cancelled) return
        const rect = target.getBoundingClientRect()
        const position = [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(':')
        stable = position === last ? stable + 1 : 0
        last = position
        if (
          (stable >= 4 && performance.now() - started > 240) ||
          performance.now() - started > 1500
        )
          show(target)
        else layoutFrame = requestAnimationFrame(tick)
      }
      layoutFrame = requestAnimationFrame(tick)
    }
    if (!selector) {
      show()
      return () => {
        cancelled = true
        engine.current?.destroy()
        engine.current = null
        setSpotlightTarget(null)
      }
    }
    const found = find()
    if (found) settle(found)
    else {
      observer = new MutationObserver(() => {
        const target = find()
        if (target) settle(target)
      })
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'data-state'],
      })
      timer = setTimeout(() => show(), 5000)
    }
    return () => {
      cancelled = true
      if (layoutFrame) cancelAnimationFrame(layoutFrame)
      observer?.disconnect()
      if (timer) clearTimeout(timer)
      stopAction?.()
      stopPlacement?.()
      engine.current?.destroy()
      engine.current = null
      setSpotlightTarget(null)
    }
  }, [
    playing,
    step,
    targetRevision,
    path,
    searchCard,
    routeQuery,
    ending,
    query.data?.required,
    cardId,
    query.data?.run?.cardId,
    current,
    t,
    advance,
    pause,
    finish,
  ])

  if (!playing || query.data?.required) return null
  if (ending)
    return (
      <TourFinale
        onDone={() => {
          setEnding(false)
          setPlaying(false)
        }}
      />
    )
  if (current.practice) return <ProjectPractice onDone={() => advance(step + 1)} onClose={pause} />
  if (error)
    return (
      <div
        role="alert"
        className="fixed inset-x-4 bottom-4 z-[10030] mx-auto max-w-lg rounded-lg border border-destructive/40 bg-card p-4 shadow-xl"
      >
        <p>{t('onboarding.saveError')}</p>
        <Button onClick={() => (current.key === 'finish' ? finish() : advance(step + 1))}>
          {t('onboarding.retry')}
        </Button>
      </div>
    )
  return (
    <>
      {spotlightTarget ? (
        <ConnectedSpotlight target={spotlightTarget} navigation={current.nav} tab={current.tab} />
      ) : null}
      {waiting ? (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-[10010] rounded-lg border border-border bg-card p-4 shadow-xl"
        >
          {t('onboarding.loading')}
        </div>
      ) : null}
    </>
  )
}
