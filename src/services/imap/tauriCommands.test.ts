import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

import {
  imapTestConnection,
  imapListFolders,
  imapCreateFolder,
  imapDeleteFolder,
  imapRenameFolder,
  imapSetFolderSubscription,
  imapListSubscribedFolders,
  imapGetCapabilities,
  imapGetFolderQuota,
  imapFetchMessages,
  imapFetchMessageHeaders,
  imapFetchNewUids,
  imapFetchMessageBody,
  imapSetFlags,
  imapMoveMessages,
  imapDeleteMessages,
  imapGetFolderStatus,
  imapFetchAttachment,
  smtpSendEmail,
  smtpTestConnection,
  type ImapConfig,
  type SmtpConfig,
} from './tauriCommands';

const testImapConfig: ImapConfig = {
  host: 'imap.example.com',
  port: 993,
  security: 'tls',
  username: 'user@example.com',
  password: 'password123',
  auth_method: 'password',
};

const testSmtpConfig: SmtpConfig = {
  host: 'smtp.example.com',
  port: 465,
  security: 'tls',
  username: 'user@example.com',
  password: 'password123',
  auth_method: 'password',
};

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('IMAP Tauri commands', () => {
  it('imapTestConnection invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue('Connected successfully. Found 5 folder(s).');

    const result = await imapTestConnection(testImapConfig);

    expect(mockInvoke).toHaveBeenCalledWith('imap_test_connection', {
      config: testImapConfig,
    });
    expect(result).toBe('Connected successfully. Found 5 folder(s).');
  });

  it('imapListFolders invokes with correct command and params', async () => {
    const folders = [
      {
        path: 'INBOX',
        raw_path: 'INBOX',
        name: 'INBOX',
        delimiter: '/',
        special_use: null,
        subscribed: true,
        selectable: true,
        has_children: false,
        exists: 42,
        unseen: 3,
      },
    ];
    mockInvoke.mockResolvedValue(folders);

    const result = await imapListFolders(testImapConfig);

    expect(mockInvoke).toHaveBeenCalledWith('imap_list_folders', {
      config: testImapConfig,
    });
    expect(result).toEqual(folders);
  });

  it('imapCreateFolder invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await imapCreateFolder(testImapConfig, 'Projects', 'Work');

    expect(mockInvoke).toHaveBeenCalledWith('imap_create_folder', {
      config: testImapConfig,
      name: 'Projects',
      parentPath: 'Work',
    });
  });

  it('imapDeleteFolder invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await imapDeleteFolder(testImapConfig, 'Work/Projects');

    expect(mockInvoke).toHaveBeenCalledWith('imap_delete_folder', {
      config: testImapConfig,
      path: 'Work/Projects',
    });
  });

  it('imapRenameFolder invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue('Work/Renamed');

    const result = await imapRenameFolder(testImapConfig, 'Work/Projects', 'Work/Renamed');

    expect(mockInvoke).toHaveBeenCalledWith('imap_rename_folder', {
      config: testImapConfig,
      path: 'Work/Projects',
      newName: 'Work/Renamed',
    });
    expect(result).toBe('Work/Renamed');
  });

  it('imapSetFolderSubscription invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await imapSetFolderSubscription(testImapConfig, 'Work/Projects', false);

    expect(mockInvoke).toHaveBeenCalledWith('imap_set_folder_subscription', {
      config: testImapConfig,
      path: 'Work/Projects',
      subscribed: false,
    });
  });

  it('imapListSubscribedFolders invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue(['INBOX']);

    const result = await imapListSubscribedFolders(testImapConfig);

    expect(mockInvoke).toHaveBeenCalledWith('imap_list_subscribed_folders', {
      config: testImapConfig,
    });
    expect(result).toEqual(['INBOX']);
  });

  it('imapGetCapabilities invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue({ quota: true, move_messages: true, special_use: false });

    const result = await imapGetCapabilities(testImapConfig);

    expect(mockInvoke).toHaveBeenCalledWith('imap_get_capabilities', {
      config: testImapConfig,
    });
    expect(result.quota).toBe(true);
  });

  it('imapGetFolderQuota invokes with correct command and params', async () => {
    const quota = {
      folder: 'INBOX',
      quota_roots: ['Userquota'],
      resources: [{ name: 'STORAGE', usage: 10, limit: 100, percent_used: 10 }],
      supported: true,
      reason: null,
    };
    mockInvoke.mockResolvedValue(quota);

    const result = await imapGetFolderQuota(testImapConfig, 'INBOX');

    expect(mockInvoke).toHaveBeenCalledWith('imap_get_folder_quota', {
      config: testImapConfig,
      path: 'INBOX',
    });
    expect(result).toEqual(quota);
  });

  it('imapFetchMessages invokes with correct command and params', async () => {
    const fetchResult = {
      messages: [],
      folder_status: {
        uidvalidity: 1,
        uidnext: 100,
        exists: 50,
        unseen: 5,
        highest_modseq: null,
      },
    };
    mockInvoke.mockResolvedValue(fetchResult);

    const result = await imapFetchMessages(testImapConfig, 'INBOX', [1, 2, 3]);

    expect(mockInvoke).toHaveBeenCalledWith('imap_fetch_messages', {
      config: testImapConfig,
      folder: 'INBOX',
      uids: [1, 2, 3],
    });
    expect(result).toEqual(fetchResult);
  });

  it('imapFetchMessageHeaders invokes with correct command and params', async () => {
    const fetchResult = {
      messages: [],
      folder_status: {
        uidvalidity: 1,
        uidnext: 100,
        exists: 50,
        unseen: 5,
        highest_modseq: null,
      },
    };
    mockInvoke.mockResolvedValue(fetchResult);

    const result = await imapFetchMessageHeaders(testImapConfig, 'INBOX', [1, 2, 3]);

    expect(mockInvoke).toHaveBeenCalledWith('imap_fetch_message_headers', {
      config: testImapConfig,
      folder: 'INBOX',
      uids: [1, 2, 3],
    });
    expect(result).toEqual(fetchResult);
  });

  it('imapFetchNewUids invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue([101, 102, 103]);

    const result = await imapFetchNewUids(testImapConfig, 'INBOX', 100);

    expect(mockInvoke).toHaveBeenCalledWith('imap_fetch_new_uids', {
      config: testImapConfig,
      folder: 'INBOX',
      sinceUid: 100,
    });
    expect(result).toEqual([101, 102, 103]);
  });

  it('imapFetchMessageBody invokes with correct command and params', async () => {
    const message = {
      uid: 42,
      folder: 'INBOX',
      message_id: '<msg@example.com>',
      in_reply_to: null,
      references: null,
      from_address: 'sender@example.com',
      from_name: 'Sender',
      to_addresses: 'user@example.com',
      cc_addresses: null,
      bcc_addresses: null,
      reply_to: null,
      subject: 'Test Subject',
      date: 1700000000,
      is_read: false,
      is_starred: false,
      is_draft: false,
      body_html: '<p>Hello</p>',
      body_text: 'Hello',
      snippet: 'Hello',
      raw_size: 1024,
      list_unsubscribe: null,
      list_unsubscribe_post: null,
      auth_results: null,
      attachments: [],
    };
    mockInvoke.mockResolvedValue(message);

    const result = await imapFetchMessageBody(testImapConfig, 'INBOX', 42);

    expect(mockInvoke).toHaveBeenCalledWith('imap_fetch_message_body', {
      config: testImapConfig,
      folder: 'INBOX',
      uid: 42,
    });
    expect(result).toEqual(message);
  });

  it('imapSetFlags invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await imapSetFlags(testImapConfig, 'INBOX', [1, 2], ['Seen'], true);

    expect(mockInvoke).toHaveBeenCalledWith('imap_set_flags', {
      config: testImapConfig,
      folder: 'INBOX',
      uids: [1, 2],
      flags: ['Seen'],
      add: true,
    });
  });

  it('imapMoveMessages invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await imapMoveMessages(testImapConfig, 'INBOX', [1, 2], 'Trash');

    expect(mockInvoke).toHaveBeenCalledWith('imap_move_messages', {
      config: testImapConfig,
      folder: 'INBOX',
      uids: [1, 2],
      destination: 'Trash',
    });
  });

  it('imapDeleteMessages invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue(undefined);

    await imapDeleteMessages(testImapConfig, 'INBOX', [1, 2]);

    expect(mockInvoke).toHaveBeenCalledWith('imap_delete_messages', {
      config: testImapConfig,
      folder: 'INBOX',
      uids: [1, 2],
    });
  });

  it('imapGetFolderStatus invokes with correct command and params', async () => {
    const status = {
      uidvalidity: 1,
      uidnext: 100,
      exists: 50,
      unseen: 5,
      highest_modseq: 12345,
    };
    mockInvoke.mockResolvedValue(status);

    const result = await imapGetFolderStatus(testImapConfig, 'INBOX');

    expect(mockInvoke).toHaveBeenCalledWith('imap_get_folder_status', {
      config: testImapConfig,
      folder: 'INBOX',
    });
    expect(result).toEqual(status);
  });

  it('imapFetchAttachment invokes with correct command and params', async () => {
    mockInvoke.mockResolvedValue('base64encodeddata==');

    const result = await imapFetchAttachment(testImapConfig, 'INBOX', 42, '1.2');

    expect(mockInvoke).toHaveBeenCalledWith('imap_fetch_attachment', {
      config: testImapConfig,
      folder: 'INBOX',
      uid: 42,
      partId: '1.2',
    });
    expect(result).toBe('base64encodeddata==');
  });
});

describe('SMTP Tauri commands', () => {
  it('smtpSendEmail invokes with correct command and params', async () => {
    const sendResult = { success: true, message: 'Email sent successfully' };
    mockInvoke.mockResolvedValue(sendResult);

    const result = await smtpSendEmail(testSmtpConfig, 'base64urlEncodedEmail');

    expect(mockInvoke).toHaveBeenCalledWith('smtp_send_email', {
      config: testSmtpConfig,
      rawEmail: 'base64urlEncodedEmail',
    });
    expect(result).toEqual(sendResult);
  });

  it('smtpTestConnection invokes with correct command and params', async () => {
    const testResult = { success: true, message: 'Connection successful' };
    mockInvoke.mockResolvedValue(testResult);

    const result = await smtpTestConnection(testSmtpConfig);

    expect(mockInvoke).toHaveBeenCalledWith('smtp_test_connection', {
      config: testSmtpConfig,
    });
    expect(result).toEqual(testResult);
  });

  it('smtpSendEmail propagates errors', async () => {
    mockInvoke.mockRejectedValue('SMTP send error: Connection refused');

    await expect(smtpSendEmail(testSmtpConfig, 'data')).rejects.toBe(
      'SMTP send error: Connection refused'
    );
  });

  it('imapTestConnection propagates errors', async () => {
    mockInvoke.mockRejectedValue('Login failed: Invalid credentials');

    await expect(imapTestConnection(testImapConfig)).rejects.toBe(
      'Login failed: Invalid credentials'
    );
  });
});
