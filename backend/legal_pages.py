"""Pages légales publiques servies par le backend.

Exigées par Google Play : la politique de confidentialité (URL de la fiche
Store) et la page de suppression de compte, joignable sans l'application.
Contenu statique, sans dépendance : `server.py` ne fait que les servir.
"""


PRIVACY_POLICY_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Politique de confidentialité — KeepEat</title>
<style>
  body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1f2937; line-height: 1.6; }
  h1 { color: #16A34A; } h2 { color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  a { color: #16A34A; }
</style>
</head>
<body>
<h1>Politique de confidentialité — KeepEat</h1>
<p><em>Dernière mise à jour : septembre 2026</em></p>

<h2>1. Qui sommes-nous ?</h2>
<p>
KeepEat est une application mobile de gestion des stocks alimentaires développée et exploitée par Francois Esperiquette.<br>
Contact : <a href="mailto:fesperiquette@hotmail.com">fesperiquette@hotmail.com</a>
</p>

<h2>2. Données collectées</h2>
<ul>
  <li><strong>Compte</strong> : adresse e-mail, mot de passe sécurisé (haché).</li>
  <li><strong>Stock alimentaire</strong> : produits, codes-barres, dates de péremption, quantités.</li>
  <li><strong>Photos (OCR)</strong> : images envoyées à un service tiers (Google Gemini) pour analyse, puis supprimées immédiatement — elles ne sont pas conservées.<br>
  <strong>Exception :</strong> si vous <em>signalez</em> un ticket mal reconnu pour demander de l’aide, la photo de ce ticket et votre adresse e-mail sont conservées afin de diagnostiquer le problème, puis supprimées automatiquement au bout de 90 jours. Ce signalement est toujours une action volontaire de votre part.</li>
  <li><strong>Import de tickets par e-mail (fonctionnalité Premium optionnelle)</strong> : si vous transférez un ticket de caisse vers l’adresse d’import (la même pour tous les utilisateurs premium — c’est votre adresse d’expéditeur qui permet de vous identifier), le contenu de cet e-mail est envoyé à Google Gemini pour analyse puis n’est pas conservé au-delà du traitement.</li>
  <li><strong>Foyer partagé (fonctionnalité optionnelle)</strong> : si vous créez ou rejoignez un foyer, votre adresse e-mail est visible par les autres membres de ce même foyer, et votre stock alimentaire leur est partagé.</li>
  <li><strong>Achats in-app</strong> : données nécessaires à la gestion des abonnements via Google Play Billing.</li>
  <li><strong>Notifications push</strong> : token technique (Expo) pour l’envoi d’alertes.</li>
  <li><strong>E-mails transactionnels</strong> : votre adresse e-mail est utilisée par notre prestataire d’envoi (Brevo) pour la vérification de compte, la réinitialisation de mot de passe et les alertes/rappels que vous avez activés.</li>
  <li><strong>Logs techniques</strong> : informations techniques (ex : adresse IP, appareil) utilisées pour la sécurité et le diagnostic.</li>
</ul>

<h2>3. Finalités</h2>
<ul>
  <li>Fournir les fonctionnalités de l’application (stock, alertes, recettes).</li>
  <li>Gérer les comptes et abonnements Premium.</li>
  <li>Envoyer des notifications.</li>
  <li>Améliorer le service et assurer la sécurité.</li>
</ul>

<h2>4. Services tiers</h2>
<ul>
  <li><strong>Render</strong> : hébergement backend.</li>
  <li><strong>MongoDB Atlas</strong> : base de données.</li>
  <li><strong>Google Gemini</strong> : OCR, import de tickets par e-mail et génération de recettes.</li>
  <li><strong>Google Play Billing</strong> : gestion des abonnements.</li>
  <li><strong>Expo / EAS</strong> : notifications push.</li>
  <li><strong>Brevo</strong> : envoi des e-mails transactionnels (vérification de compte, mot de passe, alertes).</li>
</ul>
<p>Certains services peuvent traiter des données hors UE avec des garanties appropriées.</p>

<h2>5. Conservation</h2>
<p>Les données sont conservées pendant la durée d’utilisation du service. Vous pouvez les supprimer à tout moment (voir section 6).</p>

<h2>6. Vos droits</h2>
<p>
Conformément au RGPD, vous disposez d’un droit d’accès, de rectification, d’effacement et de portabilité de vos données.
</p>
<ul>
  <li><strong>Accès et portabilité</strong> : dans l’application, <em>Réglages → Exporter mes données</em> génère un fichier contenant l’intégralité de vos données personnelles (profil, stock, tickets de caisse scannés).</li>
  <li><strong>Effacement</strong> : dans l’application, <em>Réglages → Supprimer mon compte</em> efface immédiatement et définitivement votre compte et vos données. Sans accès à l’application, une <a href="/account-deletion">page dédiée</a> explique la marche à suivre.</li>
  <li><strong>Autre demande</strong> (rectification, question) : <a href="mailto:fesperiquette@hotmail.com">fesperiquette@hotmail.com</a>, réponse sous 30 jours.</li>
</ul>

<h2>7. Sécurité</h2>
<p>Les données sont protégées via chiffrement (HTTPS), mots de passe hachés (bcrypt) et accès authentifié par jeton.</p>

<h2>8. Modifications</h2>
<p>Cette politique peut être mise à jour à tout moment ; la date de dernière mise à jour figure en haut de page.</p>

</body>
</html>"""


ACCOUNT_DELETION_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Suppression de compte — KeepEat</title>
<style>
  body { font-family: sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1f2937; line-height: 1.6; }
  h1 { color: #16A34A; } h2 { color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  a { color: #16A34A; }
  .box { background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 10px; padding: 16px 20px; margin: 16px 0; }
  ol { padding-left: 20px; }
</style>
</head>
<body>
<h1>Suppression de compte — KeepEat</h1>

<h2>Depuis l’application (recommandé, immédiat)</h2>
<div class="box">
  <ol>
    <li>Ouvrez KeepEat et connectez-vous.</li>
    <li>Allez dans <strong>Réglages</strong> (icône en bas de l’écran principal).</li>
    <li>Faites défiler jusqu’à <strong>Compte</strong>, puis appuyez sur <strong>Supprimer mon compte</strong>.</li>
    <li>Saisissez votre mot de passe pour confirmer.</li>
  </ol>
  <p>La suppression est <strong>immédiate et définitive</strong> : votre compte, votre stock, vos tickets de caisse scannés et votre historique de notifications sont effacés. Aucune sauvegarde n’est conservée.</p>
</div>

<h2>Sans accès à l’application</h2>
<p>
Si vous ne pouvez pas ouvrir l’application (compte perdu, application désinstallée), envoyez une demande de
suppression à <a href="mailto:fesperiquette@hotmail.com">fesperiquette@hotmail.com</a> depuis l’adresse e-mail
associée à votre compte KeepEat. La suppression est effectuée sous 30 jours, conformément au RGPD.
</p>

<h2>Quelles données sont supprimées ?</h2>
<ul>
  <li>Votre compte (e-mail, mot de passe haché, préférences).</li>
  <li>Votre stock alimentaire (produits, quantités, dates de péremption).</li>
  <li>Vos tickets de caisse scannés.</li>
  <li>Votre historique de notifications envoyées et vos tokens de notification push.</li>
</ul>
<p>
Certaines statistiques d’usage agrégées et anonymisées (ne permettant plus de vous identifier) peuvent être
conservées à des fins d’amélioration du service, conformément à notre
<a href="/privacy-policy">politique de confidentialité</a>.
</p>

</body>
</html>"""
