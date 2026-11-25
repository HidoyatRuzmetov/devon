import * as React from 'react'
import { useT } from '@devon/i18n'
import {
  Button,
  Dialog,
  DialogContent,
  Input,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Checkbox,
} from '@devon/ui'
import { Check, ChevronLeft, FolderKanban, ListChecks, UserRound } from 'lucide-react'
import {
  ProjectWorkspaceHeading,
  ProjectMemberPanel,
  ProjectAssignmentComposer,
  ProjectAssignmentFrame,
} from '../projects/components/project-workspace-parts.js'

/** The real project's presentation components, driven exclusively by temporary local state. */
export function ProjectPractice({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const t = useT()
  const [stage, setStage] = React.useState(0)
  const [title, setTitle] = React.useState('')
  const [draftCard, setDraftCard] = React.useState('')
  const [card, setCard] = React.useState('')
  const [item, setItem] = React.useState('')
  const [checked, setChecked] = React.useState(false)
  const [drawer, setDrawer] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    input.current?.focus()
  }, [stage])
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('onboarding.practice.title')}
        titleHidden
        aria-describedby={undefined}
        className="onboarding-practice-shell max-w-[min(1200px,96vw)] h-[92dvh] max-h-[92dvh] p-0 overflow-hidden flex flex-col"
      >
        <header className="shrink-0 border-b border-primary/20 bg-primary/5 px-5 py-4 pr-14">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card px-3 py-1 text-caption font-semibold text-primary">
              <FolderKanban className="size-4" />
              {t('onboarding.practice.badge')}
            </span>
            <h2 className="font-semibold">{t(`onboarding.practice.stage${stage}`)}</h2>
          </div>
          <p className="mt-2 text-small text-muted-foreground">
            {t(`onboarding.practice.hint${stage}`)} {t('onboarding.practice.notice')}
          </p>
          <div className="mt-3 flex gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((n) => (
              <span
                key={n}
                className={`h-1 flex-1 rounded-full ${n <= stage ? 'bg-primary' : 'bg-primary/10'}`}
              />
            ))}
          </div>
        </header>
        <div className="relative flex-1 min-h-0 overflow-y-auto bg-background p-5 md:p-8">
          <div className={`mx-auto max-w-260 space-y-5 ${drawer ? 'lg:pr-[48%]' : ''}`}>
            <p className="flex items-center gap-1 text-small text-muted-foreground">
              <ChevronLeft className="size-4" />
              {t('projects.title')}
            </p>
            <ProjectWorkspaceHeading
              title={title || t('onboarding.practice.projectPlaceholder')}
              description={t('onboarding.practice.projectDescription')}
              percent={0}
            />
            <p className="text-caption text-muted-foreground">
              {t('projectLifecycle.progressHint')}
            </p>
            {stage === 0 ? (
              <form
                className="rounded-lg border border-border bg-card p-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (title.trim()) setStage(1)
                }}
              >
                <label className="flex flex-col gap-2 text-small font-medium">
                  {t('onboarding.practice.projectName')}
                  <Input
                    ref={input}
                    value={title}
                    maxLength={80}
                    placeholder={t('onboarding.practice.projectPlaceholder')}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <Button type="submit" className="mt-4" disabled={!title.trim()}>
                  {t('onboarding.practice.create')}
                </Button>
              </form>
            ) : (
              <Tabs defaultValue="plan" className="space-y-5">
                <TabsList aria-label={t('projects.title')}>
                  <TabsTrigger value="plan">{t('projectCollaboration.plan')}</TabsTrigger>
                  <TabsTrigger value="discussion">
                    {t('projectCollaboration.discussion')}
                  </TabsTrigger>
                  <TabsTrigger value="files">{t('projectCollaboration.files')}</TabsTrigger>
                </TabsList>
                <TabsContent value="plan" className="space-y-5">
                  <section className="space-y-3">
                    <h2 className="text-small font-semibold text-muted-foreground">
                      {t('projects.field.milestones')}
                    </h2>
                    <div className="flex items-center gap-2 border-l-2 border-primary/30 pl-3 text-small">
                      <span className="size-2 rounded-full bg-border" />
                      {t('onboarding.practice.milestone')}
                    </div>
                  </section>
                  <h2 className="text-small font-semibold">
                    {t('onboarding.practice.individualCards')}
                  </h2>
                  <ProjectMemberPanel
                    name={t('onboarding.practice.you')}
                    givenName="New"
                    familyName="Member"
                    count={card ? '0/1' : '0/0'}
                  >
                    {card ? (
                      <ProjectAssignmentFrame title={card} onOpen={() => setDrawer(true)}>
                        <p className="mt-2 text-caption text-muted-foreground">
                          {item ? `${checked ? 1 : 0}/1` : '0/0'} ·{' '}
                          {t('onboarding.practice.checklist')}
                        </p>
                      </ProjectAssignmentFrame>
                    ) : (
                      <ProjectAssignmentComposer
                        value={draftCard}
                        onChange={setDraftCard}
                        onSubmit={() => {
                          setCard(draftCard.trim())
                          setStage(2)
                          setDrawer(true)
                        }}
                      />
                    )}
                  </ProjectMemberPanel>
                  <ProjectMemberPanel
                    name={t('onboarding.practice.colleague')}
                    givenName="Malika"
                    familyName="Karimova"
                    count="0/0"
                  >
                    <p className="py-2 text-caption text-muted-foreground">
                      {t('onboarding.practice.teammateHint')}
                    </p>
                  </ProjectMemberPanel>
                </TabsContent>
                <TabsContent value="discussion">
                  <p className="rounded-lg border border-border bg-card p-5 text-small">
                    {t('onboarding.practice.discussionHint')}
                  </p>
                </TabsContent>
                <TabsContent value="files">
                  <p className="rounded-lg border border-border bg-card p-5 text-small">
                    {t('onboarding.practice.filesHint')}
                  </p>
                </TabsContent>
              </Tabs>
            )}
          </div>
          {drawer && card ? (
            <aside
              data-onboarding-practice-drawer
              className="mt-5 rounded-xl border border-border bg-card shadow-xl lg:absolute lg:inset-y-4 lg:right-4 lg:mt-0 lg:w-[44%] lg:overflow-y-auto"
            >
              <header className="flex items-start justify-between gap-3 border-b border-border p-5">
                <div>
                  <p className="mb-2 text-caption text-muted-foreground">{title}</p>
                  <h3 className="text-h3">{card}</h3>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setDrawer(false)}>
                  {t('onboarding.practice.backToProject')}
                </Button>
              </header>
              <div className="space-y-6 p-5">
                <p className="flex items-center gap-2 text-small">
                  <UserRound className="size-4 text-primary" />
                  {t('onboarding.practice.assignee')}
                </p>
                <p className="text-small text-muted-foreground">
                  {t('onboarding.practice.cardDescription')}
                </p>
                <section>
                  <h4 className="mb-3 flex items-center gap-2 font-medium">
                    <ListChecks className="size-4" />
                    {t('onboarding.practice.checklist')}
                  </h4>
                  {stage === 2 ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (item.trim()) setStage(3)
                      }}
                    >
                      <label className="text-small">
                        {t('onboarding.practice.checklist')}
                        <Input
                          ref={input}
                          value={item}
                          maxLength={100}
                          placeholder={t('onboarding.practice.itemPlaceholder')}
                          onChange={(e) => setItem(e.target.value)}
                          className="mt-2"
                        />
                      </label>
                      <Button
                        type="submit"
                        variant="secondary"
                        disabled={!item.trim()}
                        className="mt-3"
                      >
                        {t('onboarding.practice.addItem')}
                      </Button>
                    </form>
                  ) : (
                    <label className="flex min-h-12 items-center gap-3 rounded-md border border-border px-3 text-small">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => setChecked(v === true)}
                        aria-label={item}
                      />
                      <span className={checked ? 'text-muted-foreground line-through' : ''}>
                        {item}
                      </span>
                    </label>
                  )}
                </section>
              </div>
            </aside>
          ) : null}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-5 py-4">
          <Button variant="ghost" onClick={onClose}>
            {t('onboarding.pause')}
          </Button>
          <span className="text-caption text-muted-foreground">
            {t('onboarding.practice.localOnly')}
          </span>
          {stage === 3 ? (
            <Button disabled={!checked} onClick={onDone}>
              <Check className="size-4" />
              {t('onboarding.practice.done')}
            </Button>
          ) : null}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
