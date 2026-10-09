import * as React from 'react'
import { createRoot } from 'react-dom/client'
import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from '@devon/ui'

const fixture = document.createElement('div')
fixture.dataset['dialogScrollFixture'] = 'true'
fixture.className = 'fixed inset-0 flex flex-col bg-background p-4'
fixture.style.zIndex = '40'
document.body.append(fixture)

function DialogFixture() {
  const [selected, setSelected] = React.useState<Date>()
  const [action, setAction] = React.useState('None')
  const [saved, setSaved] = React.useState(false)
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Open tall form</Button>
      </DialogTrigger>
      <DialogContent title="Tall form">
        <div className="flex flex-col gap-4 py-4">
          {Array.from({ length: 14 }, (_, index) => (
            <label key={index} className="flex flex-col gap-1 text-body">
              Field{index + 1}
              <Input defaultValue={`Retained value${index + 1}`} />
            </label>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Choose action</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setAction('Review selected')}>
                Review
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAction('Publish selected')}>
                Publish
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <output aria-label="Action selected">{action}</output>
          <DatePicker
            locale={new URL(location.href).searchParams.get('visualLocale') ?? 'en'}
            label="Choose date"
            placeholder="Choose a date"
            selected={selected}
            onSelect={setSelected}
          />
          <output aria-label="Date selected">{selected ? selected.toISOString() : 'None'}</output>
          <Button onClick={() => setSaved(true)}>Save form</Button>
          {saved ? <p role="status">Saved without dismissing</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

createRoot(fixture).render(<DialogFixture />)
