import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { expect, test } from 'vitest';
import NotFoundPage from './NotFoundPage';

test('standalone not-found has a main landmark, heading and working home action', async () => {
  render(<MemoryRouter initialEntries={['/missing']}><Routes><Route path="/missing" element={<NotFoundPage />} /><Route path="/" element={<p>Home</p>} /></Routes></MemoryRouter>);
  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: '页面不存在' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '回到首页' }));
  expect(screen.getByText('Home')).toBeInTheDocument();
});

test('embedded not-found keeps the host landmark and uses its language', () => {
  const messages: Record<string, string> = { '页面不存在': 'Page not found', '地址可能已变更或从未存在。': 'The address may have changed.', '回到首页': 'Return home' };
  render(<MemoryRouter><main><NotFoundPage embedded translate={(message) => messages[message] ?? message} /></main></MemoryRouter>);
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Return home' })).toBeInTheDocument();
});

test('empty translations keep meaningful default copy', () => {
  render(<MemoryRouter><NotFoundPage translate={() => '  '} /></MemoryRouter>);
  expect(screen.getByRole('heading', { level: 1, name: '页面不存在' })).toBeInTheDocument();
});
