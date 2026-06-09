-- AlterEnum
ALTER TYPE "BlockType" ADD VALUE 'image';

-- AlterTable
ALTER TABLE "Block" ADD COLUMN     "height" INTEGER,
ADD COLUMN     "src" TEXT,
ADD COLUMN     "width" INTEGER;

