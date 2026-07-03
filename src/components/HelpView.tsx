// Help: complete gebruiksaanwijzing (NL/EN), volgt de taalinstelling.
import { useApp } from "../lib/ctx";

export default function HelpView() {
  const { settings } = useApp();
  return settings.lang === "nl" ? <HelpNl /> : <HelpEn />;
}

function HelpNl() {
  return (
    <div className="help">
      <h1>Gebruiksaanwijzing BE-Mail</h1>

      <section className="settings-block">
        <h2>Aan de slag</h2>
        <ol>
          <li>
            <strong>Verbinding instellen</strong> - bij de eerste start vul je de
            Client-ID (en eventueel Tenant-ID) in die je van je beheerder hebt
            gekregen. Later aanpassen kan via <em>Instellingen → Verbinding</em>.
          </li>
          <li>
            <strong>Inloggen</strong> - klik op <em>Inloggen met Office 365</em>.
            Je browser opent de officiële Microsoft-inlogpagina; je wachtwoord
            komt nooit in deze app terecht.
          </li>
        </ol>
      </section>

      <section className="settings-block">
        <h2>Accounts</h2>
        <ul>
          <li>
            <strong>Account toevoegen</strong>: <em>Instellingen → Accounts →
            Account toevoegen</em>. Je logt in via de browser; het account
            verschijnt als eigen groep in de mappenlijst.
          </li>
          <li>
            <strong>Wisselen</strong>: klik op een map van het andere account -
            de app schakelt automatisch. De accountnaam boven elke groep is
            in- en uitklapbaar (pijltje).
          </li>
          <li>
            <strong>Account verwijderen</strong>: <em>Instellingen → Accounts →
            Uitloggen</em> bij het betreffende account.
          </li>
        </ul>
      </section>

      <section className="settings-block">
        <h2>E-mail - lezen &amp; ordenen</h2>
        <ul>
          <li><strong>Lezen</strong>: klik op een bericht; externe afbeeldingen zijn geblokkeerd tot je ze toont (veiligheid).</li>
          <li><strong>Zoeken</strong>: het zoekvak doorzoekt je héle mailbox (alle mappen); leegmaken = terug naar de map.</li>
          <li><strong>Mappen</strong>: nieuwe map via de <strong>+</strong> boven de lijst; hernoemen/verwijderen via de icoontjes die verschijnen als je over een eigen map beweegt. Sleep een map op een andere map om te nesten, of naar de rand ervan om de volgorde te wijzigen.</li>
          <li><strong>Meerdere berichten tegelijk</strong>: vink berichten aan; bovenin verschijnt een balk met Gelezen/Ongelezen, Archiveren, Verplaatsen en Verwijderen.</li>
          <li><strong>Spam</strong>: <em>Spam</em> verplaatst naar Ongewenste e-mail; het blokkeer-icoon maakt bovendien een regel die die afzender voortaan automatisch daarheen stuurt.</li>
          <li><strong>Uitschrijven</strong>: bij nieuwsbrieven met een afmeldkoppeling verschijnt automatisch een Uitschrijven-knop.</li>
          <li><strong>Bijlagen</strong>: klik op een bijlage-chip om te downloaden naar je Downloads-map.</li>
        </ul>
      </section>

      <section className="settings-block">
        <h2>E-mail - opstellen</h2>
        <ul>
          <li><strong>Nieuw bericht</strong>: blauwe knop bovenin het leesvenster; het opstelvenster opent in dezelfde kolom en sluit via het kruisje (je tekst wordt als concept bewaard).</li>
          <li><strong>Opmaak</strong>: vet, cursief, onderstrepen, lijsten en links via de werkbalk boven het tekstvak.</li>
          <li><strong>Concepten</strong>: alles wordt tijdens het typen automatisch opgeslagen; heropenen doe je vanuit de map Concepten.</li>
          <li><strong>Handtekeningen</strong>: beheer meerdere handtekeningen in Instellingen, met een aparte standaard voor nieuwe berichten en antwoorden; wisselen kan per bericht (keuzelijst onderin).</li>
          <li><strong>Bijlagen</strong>: max. ±3 MB per bericht.</li>
          <li><strong>Verzenden</strong>: na Verzenden loopt een korte bedenktijd (instelbaar) waarin je kunt annuleren. Via het klok-icoon kies je een later bezorgmoment; Exchange verstuurt het bericht dan vanzelf, ook als de app dicht is.</li>
        </ul>
      </section>

      <section className="settings-block">
        <h2>Agenda</h2>
        <ul>
          <li><strong>Weergaven</strong>: dag, werkweek, week, maand of lijst (knoppen rechtsboven).</li>
          <li><strong>Afspraak maken</strong>: knop Nieuwe afspraak, of dubbelklik op een dag.</li>
          <li><strong>Genodigden</strong>: typ een naam - suggesties uit je organisatie verschijnen vanzelf; kies met een klik of typ een los e-mailadres en druk op Enter.</li>
          <li><strong>Herhalen</strong>: dagelijks/wekelijks/maandelijks/jaarlijks met interval en einddatum (bij het aanmaken).</li>
          <li><strong>Verplaatsen</strong>: sleep een afspraak naar een andere dag; genodigden krijgen automatisch een bijgewerkte uitnodiging.</li>
          <li><strong>Uitnodigingen</strong>: een vergaderverzoek in je mail toont knoppen Accepteren / Voorlopig / Afwijzen.</li>
        </ul>
      </section>

      <section className="settings-block">
        <h2>Instellingen</h2>
        <ul>
          <li><strong>Weergave</strong>: licht/donker thema, lettertype (standaard Calibri), tekstgrootte, hoog contrast en taal (NL/EN).</li>
          <li><strong>Gedrag</strong>: verzendvertraging in seconden (0 = direct) en desktop-notificaties aan/uit.</li>
          <li><strong>Kolommen</strong>: versleep de randen tussen mappen, lijst en leesvenster om de breedte aan te passen.</li>
        </ul>
      </section>

      <section className="settings-block">
        <h2>Sneltoetsen</h2>
        <ul>
          <li><strong>↓ / j</strong> en <strong>↑ / k</strong>: volgend/vorig bericht openen</li>
          <li><strong>n</strong>: nieuw bericht</li>
          <li><strong>r</strong> / <strong>a</strong> / <strong>f</strong>: beantwoorden / allen beantwoorden / doorsturen</li>
          <li><strong>e</strong>: archiveren · <strong>Delete</strong>: verwijderen</li>
          <li><strong>u</strong>: gelezen/ongelezen · <strong>m</strong>: vlag aan/uit</li>
          <li><strong>/</strong>: naar het zoekvak</li>
        </ul>
      </section>
    </div>
  );
}

function HelpEn() {
  return (
    <div className="help">
      <h1>BE-Mail User Guide</h1>

      <section className="settings-block">
        <h2>Getting started</h2>
        <ol>
          <li>
            <strong>Set up the connection</strong> - on first start, enter the
            Client ID (and optionally Tenant ID) provided by your administrator.
            You can change this later via <em>Settings → Connection</em>.
          </li>
          <li>
            <strong>Sign in</strong> - click <em>Sign in with Office 365</em>.
            Your browser opens the official Microsoft sign-in page; your
            password never touches this app.
          </li>
        </ol>
      </section>

      <section className="settings-block">
        <h2>Accounts</h2>
        <ul>
          <li>
            <strong>Add an account</strong>: <em>Settings → Accounts → Add
            account</em>. Sign in via the browser; the account appears as its
            own group in the folder list.
          </li>
          <li>
            <strong>Switching</strong>: click any folder of the other account -
            the app switches automatically. Each account group can be collapsed
            with the arrow next to its name.
          </li>
          <li>
            <strong>Remove an account</strong>: <em>Settings → Accounts → Sign
            out</em> next to the account.
          </li>
        </ul>
      </section>

      <section className="settings-block">
        <h2>Mail - reading &amp; organising</h2>
        <ul>
          <li><strong>Reading</strong>: click a message; external images stay blocked until you show them (safety).</li>
          <li><strong>Search</strong>: the search box searches your entire mailbox (all folders); clear it to return to the folder.</li>
          <li><strong>Folders</strong>: create with the <strong>+</strong> above the list; rename/delete via the icons that appear when hovering your own folders. Drag a folder onto another to nest it, or to its edge to reorder.</li>
          <li><strong>Multiple messages</strong>: tick messages; a bar appears with Read/Unread, Archive, Move and Delete.</li>
          <li><strong>Spam</strong>: <em>Spam</em> moves to Junk Email; the block icon also creates a rule sending that sender there automatically.</li>
          <li><strong>Unsubscribe</strong>: newsletters with an unsubscribe link automatically show an Unsubscribe button.</li>
          <li><strong>Attachments</strong>: click an attachment chip to download it to your Downloads folder.</li>
        </ul>
      </section>

      <section className="settings-block">
        <h2>Mail - composing</h2>
        <ul>
          <li><strong>New message</strong>: blue button at the top of the reading pane; the composer opens in the same column and closes via the ✕ (your text is kept as a draft).</li>
          <li><strong>Formatting</strong>: bold, italic, underline, lists and links via the toolbar above the text area.</li>
          <li><strong>Drafts</strong>: everything is saved automatically while typing; reopen from the Drafts folder.</li>
          <li><strong>Signatures</strong>: manage multiple signatures in Settings, with separate defaults for new messages and replies; switch per message (dropdown at the bottom).</li>
          <li><strong>Attachments</strong>: up to ~3 MB per message.</li>
          <li><strong>Sending</strong>: after Send a short undo period runs (configurable). The clock icon lets you pick a later delivery time; Exchange sends it even if the app is closed.</li>
        </ul>
      </section>

      <section className="settings-block">
        <h2>Calendar</h2>
        <ul>
          <li><strong>Views</strong>: day, work week, week, month or list (buttons top right).</li>
          <li><strong>Create an event</strong>: New event button, or double-click a day.</li>
          <li><strong>Attendees</strong>: type a name - suggestions from your organisation appear; pick one or type an email address and press Enter.</li>
          <li><strong>Repeat</strong>: daily/weekly/monthly/yearly with interval and end date (when creating).</li>
          <li><strong>Moving</strong>: drag an event to another day; attendees automatically receive an updated invitation.</li>
          <li><strong>Invitations</strong>: a meeting request in your mail shows Accept / Tentative / Decline buttons.</li>
        </ul>
      </section>

      <section className="settings-block">
        <h2>Settings</h2>
        <ul>
          <li><strong>Appearance</strong>: light/dark theme, font (default Calibri), text size, high contrast and language (NL/EN).</li>
          <li><strong>Behaviour</strong>: send delay in seconds (0 = immediately) and desktop notifications on/off.</li>
          <li><strong>Columns</strong>: drag the dividers between folders, list and reading pane to resize.</li>
        </ul>
      </section>

      <section className="settings-block">
        <h2>Keyboard shortcuts</h2>
        <ul>
          <li><strong>↓ / j</strong> and <strong>↑ / k</strong>: open next/previous message</li>
          <li><strong>n</strong>: new message</li>
          <li><strong>r</strong> / <strong>a</strong> / <strong>f</strong>: reply / reply all / forward</li>
          <li><strong>e</strong>: archive · <strong>Delete</strong>: delete</li>
          <li><strong>u</strong>: read/unread · <strong>m</strong>: toggle flag</li>
          <li><strong>/</strong>: focus the search box</li>
        </ul>
      </section>
    </div>
  );
}
