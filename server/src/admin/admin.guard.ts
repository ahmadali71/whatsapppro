import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const jwtUser = request.user;

    if (!jwtUser) {
      throw new UnauthorizedException('Authentication required');
    }

    const userId: string | undefined = jwtUser.id ?? jwtUser.userId ?? jwtUser.sub;
    if (!userId) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        isActive: true,
        isBanned: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt || !user.isActive || user.isBanned) {
      throw new ForbiddenException('Account is inactive or suspended');
    }

    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required');
    }

    return true;
  }
}
