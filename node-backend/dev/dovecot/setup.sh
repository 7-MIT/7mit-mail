#!/usr/bin/env bash
# Starts a throwaway Dovecot (IMAP on 127.0.0.1:1143, no TLS) with the account the test-suite expects:
#   tester@7mit.test / secret123, folders INBOX + Drafts/Sent/Trash/Junk (SPECIAL-USE).
# Needs: apt-get install dovecot-imapd   (Debian/Ubuntu), run as root. Data lives in /srv/dv.
set -euo pipefail
D=/srv/dv; id vmail >/dev/null 2>&1 || useradd -m -s /bin/false vmail
mkdir -p $D/home $D/run; chown -R vmail:vmail $D/home $D/run; chmod 755 $D
echo 'tester@7mit.test:{PLAIN}secret123::::::' > $D/users
cat > $D/dovecot.conf <<CONF
base_dir = $D/run
log_path = $D/log
mail_home = $D/home/%n
mail_location = maildir:~/Maildir
protocols = imap
listen = 127.0.0.1
ssl = no
disable_plaintext_auth = no
auth_mechanisms = plain login
first_valid_uid = 1
mail_uid = vmail
mail_gid = vmail
default_internal_user = vmail
default_login_user = vmail
passdb {
  driver = passwd-file
  args = scheme=PLAIN username_format=%u $D/users
}
userdb {
  driver = static
  args = uid=vmail gid=vmail home=$D/home/%n
}
service imap-login {
  inet_listener imap {
    port = 1143
  }
  inet_listener imaps {
    port = 0
  }
}
namespace inbox {
  inbox = yes
  mailbox Drafts { special_use = \\Drafts
    auto = subscribe }
  mailbox Sent { special_use = \\Sent
    auto = subscribe }
  mailbox Trash { special_use = \\Trash
    auto = subscribe }
  mailbox Junk { special_use = \\Junk
    auto = subscribe }
}
CONF
rm -rf $D/run/*; chown -R vmail:vmail $D/run
setsid dovecot -c $D/dovecot.conf >/dev/null 2>&1 &
sleep 2; echo "Dovecot up on 127.0.0.1:1143 (tester@7mit.test / secret123)"
