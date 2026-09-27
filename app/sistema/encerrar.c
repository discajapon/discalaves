// encerrar: aplica Landlock y ejecuta el programa indicado (normalmente bwrap).
// Aísla los sockets abstractos de Unix y las señales: aunque la caja comparta la red del equipo,
// no puede conectarse a los sockets abstractos de la sesión del usuario (X11, ICE, buses) ni
// enviar señales a procesos de fuera. Requiere Linux >= 6.12; si no está, se niega a arrancar.
#define _GNU_SOURCE
#include <linux/landlock.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef SYS_landlock_create_ruleset
#define SYS_landlock_create_ruleset 444
#define SYS_landlock_restrict_self 446
#endif

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "uso: encerrar programa [argumentos]\n");
    return 2;
  }
  struct landlock_ruleset_attr reglas = {
    .scoped = LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET | LANDLOCK_SCOPE_SIGNAL,
  };
  int fd = syscall(SYS_landlock_create_ruleset, &reglas, sizeof reglas, 0);
  if (fd < 0 || prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || syscall(SYS_landlock_restrict_self, fd, 0)) {
    perror("encerrar: Landlock no disponible");
    return 1;
  }
  close(fd);
  execvp(argv[1], argv + 1);
  perror(argv[1]);
  return 127;
}
