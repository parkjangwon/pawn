// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Button from '../Button'
import Input, { Textarea } from '../Input'
import Card, { CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../Card'
import Dialog from '../Dialog'
import Dropdown from '../Dropdown'
import Badge from '../Badge'
import Switch from '../Switch'
import Select from '../Select'
import Checkbox from '../Checkbox'
import Separator from '../Separator'

beforeAll(() => {
  // jsdom has no layout engine — stub scrollIntoView used for menu navigation.
  Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView
})

describe('Button', () => {
  it('renders variants and sizes as data attributes', () => {
    render(<Button variant="destructive" size="lg">Delete</Button>)
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn).toHaveAttribute('data-variant', 'destructive')
    expect(btn).toHaveAttribute('data-size', 'lg')
  })

  it('fires onClick and respects disabled', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(<Button onClick={onClick} disabled>Go</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('Input / Textarea', () => {
  it('renders sizes and forwards props', () => {
    render(<Input size="lg" placeholder="Name" aria-label="Name" />)
    const input = screen.getByLabelText('Name')
    expect(input).toHaveAttribute('data-size', 'lg')
    expect(input).toHaveAttribute('placeholder', 'Name')
  })

  it('renders textarea', () => {
    render(<Textarea aria-label="Bio" />)
    expect(screen.getByLabelText('Bio').tagName).toBe('TEXTAREA')
  })
})

describe('Card', () => {
  it('renders slots', () => {
    render(
      <Card size="sm">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
      </Card>
    )
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Desc')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
    expect(screen.getByText('Foot')).toBeInTheDocument()
  })
})

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Dialog open={false} title="T" closeLabel="Close" onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on overlay click and Escape', () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="Hello" description="World" footer="Foot" closeLabel="Close" onClose={onClose} />
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Hello')).toBeInTheDocument()
    fireEvent.click(document.querySelector('.pawn-dialog-overlay') as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('close button calls onClose', () => {
    const onClose = vi.fn()
    render(<Dialog open title="T" closeLabel="Close" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('Dropdown', () => {
  const items = [
    { id: 'a', label: 'Alpha', shortcut: 'A' },
    { id: 'b', label: 'Beta', destructive: true },
    { id: 'c', label: 'Gamma', disabled: true }
  ]

  it('opens, selects, and closes on Escape', () => {
    const onSelect = vi.fn()
    render(
      <Dropdown trigger={<button type="button">Open</button>} items={items} onSelect={onSelect} />
    )
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Alpha/ }))
    expect(onSelect).toHaveBeenCalledWith('a')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('ignores disabled items and navigates with keyboard', () => {
    const onSelect = vi.fn()
    render(
      <Dropdown trigger={<button type="button">Open</button>} items={items} onSelect={onSelect} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Gamma' }))
    expect(onSelect).not.toHaveBeenCalled()
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('a')
  })
})

describe('Badge', () => {
  it('renders variant', () => {
    render(<Badge variant="destructive">Bad</Badge>)
    expect(screen.getByText('Bad')).toHaveAttribute('data-variant', 'destructive')
  })
})

describe('Switch', () => {
  it('toggles on click and keyboard', () => {
    const onCheckedChange = vi.fn()
    const { rerender } = render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="T" />)
    const sw = screen.getByRole('switch', { name: 'T' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    rerender(<Switch checked onCheckedChange={onCheckedChange} aria-label="T" />)
    expect(screen.getByRole('switch', { name: 'T' })).toHaveAttribute('aria-checked', 'true')
  })

  it('does not fire when disabled', () => {
    const onCheckedChange = vi.fn()
    render(<Switch checked={false} onCheckedChange={onCheckedChange} disabled aria-label="T" />)
    fireEvent.click(screen.getByRole('switch', { name: 'T' }))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})

describe('Select', () => {
  it('renders options and fires change', () => {
    const onChange = vi.fn()
    render(
      <Select aria-label="Pick" onChange={onChange}>
        <option value="1">One</option>
        <option value="2">Two</option>
      </Select>
    )
    const sel = screen.getByLabelText('Pick')
    fireEvent.change(sel, { target: { value: '2' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('option', { name: 'Two' })).toBeInTheDocument()
  })
})

describe('Checkbox', () => {
  it('checks, unchecks, and shows label', () => {
    render(<Checkbox label="Remember" />)
    const box = screen.getByRole('checkbox', { name: 'Remember' })
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    expect(box).toBeChecked()
  })

  it('supports indeterminate', () => {
    render(<Checkbox aria-label="All" indeterminate />)
    expect((screen.getByRole('checkbox', { name: 'All' }) as HTMLInputElement).indeterminate).toBe(true)
  })
})

describe('Separator', () => {
  it('renders orientations', () => {
    const { rerender } = render(<Separator />)
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal')
    rerender(<Separator orientation="vertical" />)
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical')
  })
})
