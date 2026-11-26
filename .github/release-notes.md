**New in 0.3.1**

Tasks replace assignments: a board per project, right next to your mail.

Tasks:

- **A board per project.** Cards sit in columns you set up yourself, such
  as To do, In progress, Waiting for client and Done, each with its own
  name and colour. Drag cards between columns, within a column or onto
  another project; drag a column header to change the order.
- **Everything on the card.** A card holds a description, colour,
  follow-up date, a link to the mail it came from and attachments. Paste
  a screenshot with Ctrl+V or drop files on an open card; the first image
  shows on the card itself.
- **Tasks from mail.** Make task (or t) on an open message creates a card
  that links back to that mail, with the project suggested from the
  sender's domain.
- **Follow-ups at a glance.** The red number on the Tasks button counts
  the cards whose follow-up date has come.
- **Assignments are gone.** The Assignments module and its button above
  a message have been removed. Your old assignments data stays on disk
  untouched.

Mail:

- **Tidier folder list.** Folder rows in the sidebar are more compact,
  and the expand arrow no longer touches the edge of the highlight.

Updated: Tauri 2.12.7 and DOMPurify 3.5.0 (cleans the HTML of incoming
mail).

**From 0.3.0**

Mail now keeps a conversation together, wherever its parts are filed.

Mail:

- **Whole conversations.** Opening a message shows the full exchange,
  including your own replies from Sent Items and older parts from
  Archive, each labelled with its folder.
- **Everything with a customer.** A bar above the message lists recent
  conversations with the sender's company, so a reply on the wrong mail
  is one click away. It marks the ones awaiting your reply.
- **One toolbar row.** All message buttons sit side by side in one row
  across the top of the window.
- **Deleted elsewhere.** A message deleted in another mail app now leaves
  the list with a clear notice instead of an error.

Calendar:

- **Meeting details in the invitation.** Time, place, your response and
  a small view of your own calendar that day, clashes included. A moved
  meeting shows the old time struck through, and the header says when
  someone sent it on behalf of a colleague.

Everywhere:

- **Safer.** A mail can no longer lay a fake screen over the app, links
  in mail only open web pages, external images never reach your local
  network, and calendar setup no longer sends your mail password to a
  website.
- **Faster.** Connections to Office 365 and IMAP servers are reused
  instead of rebuilt for every click.

Updated: Tauri 2.12.6, DOMPurify 3.4.18 (cleans the HTML of incoming mail)
and the IMAP library 3.0 (preview).

**From 0.2.0**

- **New update channel.** Updates now come from this repository. Coming
  from 0.1.x? Install this version once by hand.
- **Security updates** for SQLite, TLS and the bundled libraries.
