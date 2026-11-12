import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect,vi} from 'vitest';
import {IntakeHandoffDialog} from './IntakeHandoffDialog';
const change={label:'Target date',before:'Nov 5, 2026',after:'Nov 10, 2026'};
describe('Intake handoff decision',()=>{
 it('cannot stop follow-up for an empty edit',()=>{
  render(<IntakeHandoffDialog changes={[]} stage="rule" onConfirm={vi.fn()} onCancel={vi.fn()}/>);
  expect(screen.getByRole('button',{name:'Save and stop follow-up'})).toBeDisabled();
 });
 it('keeps recovery available without telling a locked save to go back',async()=>{
  const check=vi.fn(),confirm=vi.fn(),cancel=vi.fn();
  render(<IntakeHandoffDialog changes={[change]} stage="rule" stale locked uncertain onCheckAgain={check} onConfirm={confirm} onCancel={cancel}/>);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('The save could not be confirmed');
  expect(screen.getByRole('button',{name:'Check again'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Cancel edit'})).toBeDisabled();
  await userEvent.click(screen.getByRole('button',{name:'Check again'}));
  expect(check).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();expect(cancel).not.toHaveBeenCalled();
 });
 it('explains the consequence and requires a deliberate save',async()=>{
  const confirm=vi.fn(),cancel=vi.fn();const user=userEvent.setup();
  render(<IntakeHandoffDialog changes={[change]} stage="rule" onConfirm={confirm} onCancel={cancel}/>);
  expect(screen.getByRole('dialog',{name:'Stop automatic follow-up?'})).toBeInTheDocument();
  expect(screen.getByText(/Saving these changes stops/)).toHaveTextContent(/replies will still be recorded/);
  expect(screen.getByText('Target date')).toBeInTheDocument();expect(screen.getByText(/From Nov 5/)).toHaveTextContent('Nov 10, 2026');
  expect(confirm).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'Save and stop follow-up'}));expect(confirm).toHaveBeenCalledOnce();expect(cancel).not.toHaveBeenCalled();
 });
 it('allows cancelling and Escape without invoking save',async()=>{
  const confirm=vi.fn(),cancel=vi.fn();const user=userEvent.setup();
  render(<IntakeHandoffDialog changes={[change]} stage="rule" onConfirm={confirm} onCancel={cancel}/>);
  await user.click(screen.getByRole('button',{name:'Cancel edit'}));expect(cancel).toHaveBeenCalledOnce();expect(confirm).not.toHaveBeenCalled();
  await user.keyboard('{Escape}');expect(cancel).toHaveBeenCalledTimes(2);expect(confirm).not.toHaveBeenCalled();
 });
 it('explains readiness preprocessing without promising continued automatic questions',()=>{
  render(<IntakeHandoffDialog changes={[change]} stage="readiness" onConfirm={vi.fn()} onCancel={vi.fn()}/>);
  expect(screen.getByText('Preprocessing will continue with the information already received.')).toBeInTheDocument();
 });
 it('refuses stale approval and keeps long names readable',async()=>{
  const confirm=vi.fn();const user=userEvent.setup();const name='Fictional International Procurement and Supplier Operations';
  render(<IntakeHandoffDialog changes={[{label:'Requester name',before:'Alex',after:name}]} stage="rule" stale onConfirm={confirm} onCancel={vi.fn()}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('The request changed');expect(screen.getByText(name)).toBeInTheDocument();
  const save=screen.getByRole('button',{name:'Save and stop follow-up'});expect(save).toBeDisabled();await user.click(save);expect(confirm).not.toHaveBeenCalled();
 });
});
