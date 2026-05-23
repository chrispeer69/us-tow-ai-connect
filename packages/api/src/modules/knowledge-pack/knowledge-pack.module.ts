import { Module } from '@nestjs/common';
import {
  KnowledgePackAdminController,
  KnowledgePackPublicController,
} from './knowledge-pack.controller';
import { KnowledgePackService } from './knowledge-pack.service';

@Module({
  controllers: [KnowledgePackAdminController, KnowledgePackPublicController],
  providers: [KnowledgePackService],
  exports: [KnowledgePackService],
})
export class KnowledgePackModule {}
